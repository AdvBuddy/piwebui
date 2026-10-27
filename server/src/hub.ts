import crypto from "node:crypto";
import { WebSocket } from "ws";
import type { AgentFrame, AgentToClient, BrowserFrame, ClientToAgent, ServerFrame, ServerToAgentFrame } from "@piwebui/shared";
import { safeEqual } from "./auth.js";
import { config } from "./config.js";

const HEARTBEAT_MS = 30_000;
const AGENT_HANDSHAKE_TIMEOUT_MS = 8_000;
const MAX_BUFFERED_BYTES = 32 * 1024 * 1024;

interface AgentConn {
	ws: WebSocket;
	id: string;
	host: string;
	cwd: string;
	pid: number;
	version: string;
	connectedAt: number;
}

interface BrowserConn {
	ws: WebSocket;
	id: string;
	alive: boolean;
}

/**
 * Fan-out point between the single local agent and N browsers.
 *
 * The relay is intentionally stateless with respect to conversation content: pi's
 * own session files are the source of truth, and a browser rebuilds its view with
 * `get_state` + `get_messages` after any reconnect.
 */
export class Hub {
	private agent: AgentConn | null = null;
	private browsers = new Set<BrowserConn>();
	private heartbeat: NodeJS.Timeout;

	constructor() {
		this.heartbeat = setInterval(() => this.sweep(), HEARTBEAT_MS);
		this.heartbeat.unref?.();
	}

	get agentOnline(): boolean {
		return this.agent !== null && this.agent.ws.readyState === WebSocket.OPEN;
	}

	get agentCwd(): string | null {
		return this.agent?.cwd ?? null;
	}

	get browserCount(): number {
		return this.browsers.size;
	}

	/* ---------------------------------------------------------------- */
	/* agent side                                                        */
	/* ---------------------------------------------------------------- */

	attachAgent(ws: WebSocket): void {
		let authed = false;
		let handshakeTimer: NodeJS.Timeout | null = setTimeout(() => {
			if (!authed) {
				sendAgent(ws, { type: "error", message: "handshake timeout" });
				ws.close(1008, "handshake timeout");
			}
		}, AGENT_HANDSHAKE_TIMEOUT_MS);
		handshakeTimer.unref?.();

		ws.on("message", (data) => {
			let frame: AgentFrame;
			try {
				frame = JSON.parse(data.toString()) as AgentFrame;
			} catch {
				return;
			}

			if (!authed) {
				if (frame.type !== "hello") {
					ws.close(1008, "expected hello");
					return;
				}
				if (!config.agentSecret || !safeEqual(frame.secret ?? "", config.agentSecret)) {
					log("agent rejected: bad secret");
					sendAgent(ws, { type: "error", message: "bad agent secret" });
					ws.close(1008, "bad secret");
					return;
				}
				authed = true;
				if (handshakeTimer) {
					clearTimeout(handshakeTimer);
					handshakeTimer = null;
				}

				// Single-agent model: a reconnect supersedes the previous socket.
				if (this.agent && this.agent.ws !== ws) {
					try {
						this.agent.ws.close(1000, "replaced by newer connection");
					} catch {
						/* ignore */
					}
				}

				this.agent = {
					ws,
					id: crypto.randomUUID(),
					host: frame.host,
					cwd: frame.cwd,
					pid: frame.pid,
					version: frame.version,
					connectedAt: Date.now(),
				};
				log(`agent attached: ${frame.host} cwd=${frame.cwd} pid=${frame.pid} v${frame.version}`);
				sendAgent(ws, { type: "hello_ok", serverTime: Date.now(), clients: this.browsers.size });
				this.broadcast({ type: "agent_status", online: true, cwd: frame.cwd });
				return;
			}

			switch (frame.type) {
				case "relay":
					this.broadcast({ type: "relay", record: frame.record });
					break;
				case "ping":
					sendAgent(ws, { type: "pong", t: frame.t });
					break;
				default:
					break;
			}
		});

		ws.on("pong", () => {
			/* liveness only */
		});

		ws.on("close", () => {
			if (handshakeTimer) clearTimeout(handshakeTimer);
			if (this.agent?.ws === ws) {
				log("agent detached");
				this.agent = null;
				this.broadcast({ type: "agent_status", online: false });
			}
		});

		ws.on("error", (error) => {
			log(`agent socket error: ${error.message}`);
		});
	}

	/* ---------------------------------------------------------------- */
	/* browser side                                                      */
	/* ---------------------------------------------------------------- */

	attachBrowser(ws: WebSocket): void {
		const conn: BrowserConn = { ws, id: crypto.randomUUID(), alive: true };
		this.browsers.add(conn);

		sendBrowser(ws, {
			type: "hello",
			agentOnline: this.agentOnline,
			serverTime: Date.now(),
			cwd: this.agentCwd,
			version: "0.1.0",
		});

		ws.on("message", (data) => {
			conn.alive = true;
			let frame: BrowserFrame;
			try {
				frame = JSON.parse(data.toString()) as BrowserFrame;
			} catch {
				return;
			}

			if (frame.type === "ping") {
				sendBrowser(ws, { type: "hello", agentOnline: this.agentOnline, serverTime: Date.now(), cwd: this.agentCwd, version: "0.1.0" });
				return;
			}

			if (frame.type !== "relay") return;

			const agent = this.agent;
			if (!agent || agent.ws.readyState !== WebSocket.OPEN) {
				sendBrowser(ws, { type: "error", message: "本地 agent 未连接，命令已丢弃" });
				return;
			}
			sendAgent(agent.ws, { type: "relay", record: frame.record });
		});

		ws.on("pong", () => {
			conn.alive = true;
		});

		ws.on("close", () => {
			this.browsers.delete(conn);
		});

		ws.on("error", () => {
			this.browsers.delete(conn);
		});
	}

	/* ---------------------------------------------------------------- */
	/* plumbing                                                          */
	/* ---------------------------------------------------------------- */

	broadcast(frame: ServerFrame): void {
		const payload = JSON.stringify(frame);
		for (const conn of this.browsers) {
			if (conn.ws.readyState !== WebSocket.OPEN) {
				this.browsers.delete(conn);
				continue;
			}
			if (conn.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
				// A browser that cannot keep up gets dropped rather than growing memory
				// without bound; it will reconnect and re-sync from session state.
				log("dropping slow browser client");
				conn.ws.terminate();
				this.browsers.delete(conn);
				continue;
			}
			conn.ws.send(payload);
		}
	}

	/** Send an agent record to a single browser (used for targeted errors). */
	sendToBrowser(ws: WebSocket, record: AgentToClient): void {
		sendBrowser(ws, { type: "relay", record });
	}

	shutdown(): void {
		clearInterval(this.heartbeat);
		for (const conn of this.browsers) {
			try {
				conn.ws.close(1001, "server shutting down");
			} catch {
				/* ignore */
			}
		}
		this.browsers.clear();
		try {
			this.agent?.ws.close(1001, "server shutting down");
		} catch {
			/* ignore */
		}
		this.agent = null;
	}

	private sweep(): void {
		for (const conn of this.browsers) {
			if (!conn.alive) {
				conn.ws.terminate();
				this.browsers.delete(conn);
				continue;
			}
			conn.alive = false;
			try {
				conn.ws.ping();
			} catch {
				/* ignore */
			}
		}
		if (this.agent) {
			try {
				this.agent.ws.ping();
			} catch {
				/* ignore */
			}
		}
	}
}

function sendAgent(ws: WebSocket, frame: ServerToAgentFrame): void {
	if (ws.readyState !== WebSocket.OPEN) return;
	ws.send(JSON.stringify(frame));
}

function sendBrowser(ws: WebSocket, frame: ServerFrame): void {
	if (ws.readyState !== WebSocket.OPEN) return;
	ws.send(JSON.stringify(frame));
}

function log(message: string): void {
	process.stderr.write(`[hub] ${message}\n`);
}

export const hub = new Hub();
