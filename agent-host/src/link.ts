import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { AgentFrame, AgentToClient, ClientToAgent, ServerToAgentFrame } from "@piwebui/shared";

export interface LinkOptions {
	url: string;
	secret: string;
	hostName: string;
	cwd: string;
	version: string;
	reconnectBaseMs: number;
	reconnectMaxMs: number;
	verbose: boolean;
}

export interface LinkEvents {
	open: () => void;
	record: (record: ClientToAgent) => void;
	close: (reason: string) => void;
}

/**
 * Outbound WebSocket from the local machine to the relay server.
 *
 * Dialing outward means the local box never needs a public IP, port forward, or
 * inbound firewall rule — and it keeps pi's bash/edit tools off the open internet.
 */
export class ServerLink extends EventEmitter {
	private ws: WebSocket | null = null;
	private attempts = 0;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private heartbeatTimer: NodeJS.Timeout | null = null;
	private lastPong = 0;
	private closedByUser = false;
	private handshaken = false;

	constructor(
		private readonly opts: LinkOptions,
		private readonly handlers: LinkEvents,
	) {
		super();
	}

	get connected(): boolean {
		return this.handshaken && this.ws?.readyState === WebSocket.OPEN;
	}

	connect(): void {
		if (this.ws) return;
		this.closedByUser = false;

		let ws: WebSocket;
		try {
			ws = new WebSocket(this.opts.url, {
				handshakeTimeout: 15000,
				// Images arrive as base64 inside prompt commands; keep headroom.
				maxPayload: 64 * 1024 * 1024,
				perMessageDeflate: false,
			});
		} catch (error) {
			this.log(`connect failed: ${String(error)}`);
			this.scheduleReconnect();
			return;
		}

		this.ws = ws;

		ws.on("open", () => {
			this.log(`connected to ${this.opts.url}`);
			const hello: AgentFrame = {
				type: "hello",
				secret: this.opts.secret,
				host: this.opts.hostName,
				cwd: this.opts.cwd,
				pid: process.pid,
				version: this.opts.version,
			};
			ws.send(JSON.stringify(hello));
			this.lastPong = Date.now();
			this.startHeartbeat();
		});

		ws.on("message", (data: WebSocket.RawData) => {
			let frame: ServerToAgentFrame;
			try {
				frame = JSON.parse(data.toString()) as ServerToAgentFrame;
			} catch {
				return;
			}
			switch (frame.type) {
				case "hello_ok":
					this.handshaken = true;
					this.attempts = 0;
					this.log(`handshake ok (${frame.clients} browsers attached)`);
					this.handlers.open();
					break;
				case "relay":
					this.handlers.record(frame.record);
					break;
				case "pong":
					this.lastPong = Date.now();
					break;
				case "error":
					this.log(`server error: ${frame.message}`);
					break;
			}
		});

		ws.on("pong", () => {
			this.lastPong = Date.now();
		});

		ws.on("close", (code, reason) => {
			const text = `${code}${reason?.length ? ` ${reason.toString()}` : ""}`;
			this.log(`disconnected (${text})`);
			this.cleanup();
			this.handlers.close(text);
			if (!this.closedByUser) this.scheduleReconnect();
		});

		ws.on("error", (error) => {
			this.log(`socket error: ${error.message}`);
		});
	}

	send(record: AgentToClient): void {
		if (!this.connected || !this.ws) return;
		try {
			this.ws.send(JSON.stringify({ type: "relay", record } satisfies AgentFrame));
		} catch (error) {
			this.log(`send failed: ${String(error)}`);
		}
	}

	close(): void {
		this.closedByUser = true;
		this.cleanup();
		this.ws?.close();
		this.ws = null;
	}

	private startHeartbeat(): void {
		this.stopHeartbeat();
		this.heartbeatTimer = setInterval(() => {
			if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
			// Server answers protocol pings from the browser side; here a plain ping
			// + staleness check is enough to notice half-open sockets after sleep.
			if (Date.now() - this.lastPong > 75_000) {
				this.log("heartbeat timeout, recycling socket");
				this.ws.terminate();
				return;
			}
			try {
				this.ws.ping();
			} catch {
				/* ignore */
			}
		}, 25_000);
		this.heartbeatTimer.unref?.();
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	private cleanup(): void {
		this.handshaken = false;
		this.stopHeartbeat();
		this.ws = null;
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer || this.closedByUser) return;
		const exp = Math.min(this.opts.reconnectBaseMs * 2 ** this.attempts, this.opts.reconnectMaxMs);
		const delay = Math.round(exp * (0.75 + Math.random() * 0.5));
		this.attempts += 1;
		this.log(`reconnecting in ${delay}ms (attempt ${this.attempts})`);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, delay);
		this.reconnectTimer.unref?.();
	}

	private log(message: string): void {
		process.stderr.write(`[link] ${message}\n`);
	}
}
