import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AgentConfig {
	/** WebSocket endpoint of the relay server, e.g. wss://pi.example.com/agent */
	serverUrl: string;
	/** Shared secret; must match AGENT_SECRET on the server */
	secret: string;
	/** Working directory pi runs in (the project you want to drive) */
	cwd: string;
	/** Executable used to launch pi */
	piBin: string;
	/** Extra args appended after `--mode rpc` */
	piArgs: string[];
	/** Where pi stores session jsonl files (default: ~/.pi/agent/sessions) */
	sessionDir: string;
	/** Restart pi automatically when it exits unexpectedly */
	autoRestart: boolean;
	/** Label shown in the web UI */
	hostName: string;
	/** Print every raw protocol line to stderr */
	verbose: boolean;
	/** Reconnect base delay in ms */
	reconnectBaseMs: number;
	/** Reconnect max delay in ms */
	reconnectMaxMs: number;
}

function readEnvFile(file: string): Record<string, string> {
	const out: Record<string, string> = {};
	let raw: string;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch {
		return out;
	}
	for (const sourceLine of raw.split(/\r?\n/)) {
		const line = sourceLine.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq === -1) continue;
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
			(value.startsWith("'") && value.endsWith("'") && value.length >= 2)
		) {
			value = value.slice(1, -1);
		}
		out[key] = value;
	}
	return out;
}

function bool(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined || value === "") return fallback;
	return /^(1|true|yes|on)$/i.test(value.trim());
}

export function defaultSessionDir(): string {
	return path.join(os.homedir(), ".pi", "agent", "sessions");
}

export function loadConfig(): AgentConfig {
	const envFile = path.resolve(process.cwd(), ".env");
	const fileEnv = readEnvFile(envFile);
	const get = (key: string): string | undefined => process.env[key] ?? fileEnv[key];

	const serverUrl = get("PIWEBUI_SERVER_URL") ?? "ws://127.0.0.1:8787/agent";
	const secret = get("AGENT_SECRET") ?? "";
	const cwd = path.resolve(get("PI_CWD") ?? process.cwd());

	const extraArgs = (get("PI_ARGS") ?? "")
		.split(/\s+/)
		.map((s) => s.trim())
		.filter(Boolean);

	return {
		serverUrl,
		secret,
		cwd,
		piBin: get("PI_BIN") || "pi",
		piArgs: extraArgs,
		// `PI_SESSION_DIR=` in .env means "use the default"; an empty string must not
		// shadow it, so use `||` rather than `??` here.
		sessionDir: get("PI_SESSION_DIR") || defaultSessionDir(),
		autoRestart: bool(get("PI_AUTO_RESTART"), true),
		hostName: get("PIWEBUI_HOST_NAME") || os.hostname(),
		verbose: bool(get("PIWEBUI_VERBOSE"), false),
		reconnectBaseMs: Number(get("PIWEBUI_RECONNECT_BASE_MS") || 1000),
		reconnectMaxMs: Number(get("PIWEBUI_RECONNECT_MAX_MS") || 20000),
	};
}
