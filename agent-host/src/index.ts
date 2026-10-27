import process from "node:process";
import path from "node:path";
import { loadConfig } from "./config.js";
import { PiProcess } from "./pi-process.js";
import { ServerLink } from "./link.js";
import { listSessions, readSessionHeader } from "./sessions.js";
import type { AgentToClient, ClientToAgent, LocalCommand, SessionSummary } from "@piwebui/shared";

const VERSION = "0.1.0";
const config = loadConfig();

if (!config.secret) {
	process.stderr.write(
		"[fatal] AGENT_SECRET is not set. Put it in agent-host/.env (it must match the server's AGENT_SECRET).\n",
	);
	process.exit(1);
}

const log = (message: string) => process.stderr.write(`[agent] ${message}\n`);

/** pi is bound to one working directory; opening a session elsewhere restarts it. */
let currentCwd = config.cwd;

const pending: ClientToAgent[] = [];

const pi = new PiProcess(
	{
		bin: config.piBin,
		args: config.piArgs,
		cwd: currentCwd,
		autoRestart: config.autoRestart,
		verbose: config.verbose,
	},
	{
		record: (record) => {
			link.send(record as AgentToClient);
		},
		stderr: (line) => {
			log(`pi: ${line}`);
			link.send({ type: "piwebui_stderr", line });
		},
		state: (state, info) => {
			log(`pi ${state}${info?.code !== undefined ? ` (code=${info.code})` : ""}`);
			link.send({
				type: "piwebui_process",
				state,
				code: info?.code ?? undefined,
				signal: info?.signal ?? undefined,
			});
			if (state === "ready") flushPending();
		},
	},
);

const link = new ServerLink(
	{
		url: config.serverUrl,
		secret: config.secret,
		hostName: config.hostName,
		cwd: currentCwd,
		version: VERSION,
		reconnectBaseMs: config.reconnectBaseMs,
		reconnectMaxMs: config.reconnectMaxMs,
		verbose: config.verbose,
	},
	{
		open: () => {
			log("relay attached, refreshing state");
			// Push a fresh state snapshot so a browser that attaches later can rebuild
			// without waiting for the next user action.
			pi.send({ id: `boot-${Date.now()}`, type: "get_state" });
			flushPending();
		},
		record: (record) => {
			void handleRecord(record);
		},
		close: () => {
			/* ServerLink handles reconnect */
		},
	},
);

async function handleRecord(record: ClientToAgent): Promise<void> {
	if (record && typeof record === "object" && "type" in record) {
		const type = (record as { type: string }).type;
		if (type === "extension_ui_response") {
			pi.send(record);
			return;
		}
		if (type.startsWith("piwebui_")) {
			await handleLocal(record as LocalCommand);
			return;
		}
	}

	if (!pi.running) {
		pending.push(record);
		if (pending.length > 32) pending.shift();
		log(`pi not running, queued ${(record as { type?: string }).type ?? "record"}`);
		return;
	}
	pi.send(record);
}

async function handleLocal(command: LocalCommand): Promise<void> {
	const reply = (data: unknown, commandName: string) => {
		link.send({
			type: "response",
			id: command.id,
			command: commandName,
			success: true,
			data,
		} as AgentToClient);
	};

	switch (command.type) {
		case "piwebui_list_sessions": {
			const sessions: SessionSummary[] = await listSessions(config.sessionDir, {
				cwd: currentCwd,
				limit: command.limit ?? 50,
			});
			reply({ sessions }, "piwebui_list_sessions");
			return;
		}
		case "piwebui_open_session": {
			const header = await readSessionHeader(command.sessionPath);
			if (!header) {
				link.send({
					type: "response",
					id: command.id,
					command: "piwebui_open_session",
					success: false,
					error: "无法读取该会话文件",
				} as AgentToClient);
				return;
			}

			const sameCwd =
				path.normalize(header.cwd).toLowerCase() === path.normalize(currentCwd).toLowerCase();

			if (sameCwd) {
				// Cheap path: pi swaps sessions in place, no restart, no lost context.
				pi.send({ type: "switch_session", sessionPath: command.sessionPath });
				reply({ switched: true, restarted: false, cwd: currentCwd }, "piwebui_open_session");
				return;
			}

			// Different project: pi's cwd is fixed at launch, so relaunch pointed at
			// the session's own directory and reopen the file directly.
			log(`switching project: ${currentCwd} -> ${header.cwd}`);
			await pi.stop();
			currentCwd = header.cwd;
			pi.reconfigure({
				cwd: header.cwd,
				args: [...config.piArgs, "--session", command.sessionPath],
			});
			pending.length = 0;
			pi.start();
			reply({ switched: true, restarted: true, cwd: currentCwd }, "piwebui_open_session");
			return;
		}
		case "piwebui_ping": {
			reply(
				{
					host: config.hostName,
					cwd: currentCwd,
					pid: process.pid,
					piRunning: pi.running,
					piPid: pi.pid,
					version: VERSION,
					uptimeSec: Math.round(process.uptime()),
				},
				"piwebui_ping",
			);
			return;
		}
		case "piwebui_restart_pi": {
			log("restart requested from web UI");
			await pi.restart();
			reply({ restarted: true }, "piwebui_restart_pi");
			return;
		}
		case "piwebui_get_config": {
			reply(
				{
					cwd: currentCwd,
					host: config.hostName,
					sessionDir: config.sessionDir,
					piArgs: config.piArgs,
					version: VERSION,
				},
				"piwebui_get_config",
			);
			return;
		}
		default: {
			link.send({
				type: "response",
				id: (command as { id?: string }).id,
				command: (command as { type: string }).type,
				success: false,
				error: `unknown local command: ${(command as { type: string }).type}`,
			} as AgentToClient);
		}
	}
}

function flushPending(): void {
	if (!pi.running || pending.length === 0) return;
	while (pending.length > 0) {
		const record = pending.shift()!;
		pi.send(record);
	}
}

async function shutdown(signal: string): Promise<void> {
	log(`received ${signal}, shutting down`);
	link.close();
	await pi.stop();
	process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("uncaughtException", (error) => {
	log(`uncaught: ${error.stack ?? String(error)}`);
});
process.on("unhandledRejection", (reason) => {
	log(`unhandled rejection: ${String(reason)}`);
});

log(`piwebui agent-host v${VERSION}`);
log(`  cwd        : ${currentCwd}`);
log(`  sessions   : ${config.sessionDir}`);
log(`  relay      : ${config.serverUrl}`);
log(`  pi binary  : ${config.piBin}${config.piArgs.length ? ` ${config.piArgs.join(" ")}` : ""}`);

pi.start();
link.connect();
