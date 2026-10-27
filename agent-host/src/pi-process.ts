import { exec, spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

const isWindows = process.platform === "win32";

export type PiState = "starting" | "ready" | "exited";

export interface PiProcessOptions {
	bin: string;
	args: string[];
	cwd: string;
	autoRestart: boolean;
	verbose: boolean;
}

export interface PiProcessEvents {
	record: (record: unknown) => void;
	stderr: (line: string) => void;
	state: (state: PiState, info?: { code?: number | null; signal?: NodeJS.Signals | null }) => void;
}

/**
 * Owns the `pi --mode rpc` child process and speaks its strict JSONL framing.
 *
 * Two details matter and are easy to get wrong:
 *  - Split records on LF only. Node's readline also splits on U+2028/U+2029 which
 *    are legal inside JSON strings, so we do our own buffer scan.
 *  - Never stop reading stdout. pi honours backpressure, but a client that stops
 *    draining can stall the agent mid-stream.
 */
export class PiProcess extends EventEmitter {
	private child: ChildProcess | null = null;
	private stdoutBuffer: Buffer = Buffer.alloc(0);
	private stderrBuffer = "";
	private stopping = false;
	private restartTimer: NodeJS.Timeout | null = null;
	private restartAttempts = 0;
	private readyTimer: NodeJS.Timeout | null = null;
	private readonly handlers: PiProcessEvents;
	private opts: PiProcessOptions;

	constructor(opts: PiProcessOptions, handlers: PiProcessEvents) {
		super();
		this.opts = opts;
		this.handlers = handlers;
	}

	get pid(): number | undefined {
		return this.child?.pid;
	}

	get running(): boolean {
		return this.child !== null && this.child.exitCode === null && !this.child.killed;
	}

	get cwd(): string {
		return this.opts.cwd;
	}

	get args(): string[] {
		return this.opts.args;
	}

	/**
	 * Swaps launch parameters. Only meaningful while stopped — callers restart
	 * afterwards, which is how cross-project session switching works.
	 */
	reconfigure(patch: Partial<Pick<PiProcessOptions, "cwd" | "args">>): void {
		this.opts = { ...this.opts, ...patch };
	}

	start(): void {
		if (this.child) return;
		this.stopping = false;
		this.stdoutBuffer = Buffer.alloc(0);
		this.stderrBuffer = "";

		const args = ["--mode", "rpc", ...this.opts.args];
		if (this.opts.verbose) {
			process.stderr.write(`[pi] spawn ${this.opts.bin} ${args.join(" ")} (cwd=${this.opts.cwd})\n`);
		}
		this.handlers.state("starting");

		let child: ChildProcess;
		try {
			child = spawn(this.opts.bin, isWindows ? args.map(winQuote) : args, {
				cwd: this.opts.cwd,
				// Windows resolves `pi` to the npm shim `pi.cmd`, which cannot be spawned
				// without a shell. Arguments are all static/validated, so this is safe.
				shell: isWindows,
				windowsHide: true,
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env, ...(isWindows ? {} : {}) },
				detached: false,
			});
		} catch (error) {
			this.emitError(error);
			this.scheduleRestart();
			return;
		}

		this.child = child;

		child.on("error", (error) => {
			this.emitError(error);
			this.handlers.stderr(`[spawn error] ${String(error)}`);
			this.scheduleRestart();
		});

		child.stdout?.on("data", (chunk: Buffer) => this.consumeStdout(chunk));

		child.stderr?.on("data", (chunk: Buffer) => {
			this.stderrBuffer += chunk.toString("utf8");
			const lines = this.stderrBuffer.split(/\r?\n/);
			this.stderrBuffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				if (this.opts.verbose) process.stderr.write(`[pi:stderr] ${line}\n`);
				this.handlers.stderr(line);
			}
		});

		child.on("exit", (code, signal) => {
			if (this.readyTimer) {
				clearTimeout(this.readyTimer);
				this.readyTimer = null;
			}
			this.child = null;
			this.restartAttempts = this.stopping ? 0 : this.restartAttempts;
			this.handlers.state("exited", { code, signal });
			if (!this.stopping) this.scheduleRestart();
		});

		// pi has no explicit "ready" handshake; a successful spawn is enough to
		// accept commands on stdin. Delay slightly so immediate writes land after
		// the runtime installs its stdin reader.
		this.readyTimer = setTimeout(() => {
			this.readyTimer = null;
			if (this.running) {
				this.restartAttempts = 0;
				this.handlers.state("ready");
			}
		}, 150);
	}

	private consumeStdout(chunk: Buffer): void {
		this.stdoutBuffer = this.stdoutBuffer.length === 0 ? chunk : Buffer.concat([this.stdoutBuffer, chunk]);

		let start = 0;
		for (;;) {
			const idx = this.stdoutBuffer.indexOf(0x0a, start);
			if (idx === -1) break;
			let end = idx;
			if (end > start && this.stdoutBuffer[end - 1] === 0x0d) end -= 1;
			const line = this.stdoutBuffer.subarray(start, end).toString("utf8");
			start = idx + 1;
			if (line.trim()) this.handleLine(line);
		}
		this.stdoutBuffer = start === 0 ? this.stdoutBuffer : this.stdoutBuffer.subarray(start);
		// Guard against a pathological line with no newline for a very long time.
		if (this.stdoutBuffer.length > 64 * 1024 * 1024) {
			this.handlers.stderr("[piwebui] stdout buffer exceeded 64MB without a newline, resetting");
			this.stdoutBuffer = Buffer.alloc(0);
		}
	}

	private handleLine(line: string): void {
		if (this.opts.verbose) {
			const preview = line.length > 400 ? `${line.slice(0, 400)}…` : line;
			process.stderr.write(`[pi] <- ${preview}\n`);
		}
		let record: unknown;
		try {
			record = JSON.parse(line);
		} catch {
			this.handlers.stderr(`[piwebui] unparsable stdout line: ${line.slice(0, 200)}`);
			return;
		}
		this.handlers.record(record);
	}

	send(record: unknown): boolean {
		const child = this.child;
		if (!child || !child.stdin || child.stdin.destroyed) return false;
		const payload = `${JSON.stringify(record)}\n`;
		if (this.opts.verbose) {
			const preview = payload.length > 400 ? `${payload.slice(0, 400)}…` : payload;
			process.stderr.write(`[pi] -> ${preview}`);
		}
		try {
			const ok = child.stdin.write(payload, "utf8");
			if (!ok) {
				// Backpressure: wait for drain before accepting more writes. We do not
				// block the caller — pi will catch up; queue depth is bounded by the
				// relay's own socket backpressure.
			}
			return true;
		} catch (error) {
			this.handlers.stderr(`[piwebui] stdin write failed: ${String(error)}`);
			return false;
		}
	}

	private scheduleRestart(): void {
		if (!this.opts.autoRestart || this.stopping || this.restartTimer) return;
		const delay = Math.min(1000 * 2 ** this.restartAttempts, 15000);
		this.restartAttempts += 1;
		this.handlers.stderr(`[piwebui] pi exited, restarting in ${delay}ms (attempt ${this.restartAttempts})`);
		this.restartTimer = setTimeout(() => {
			this.restartTimer = null;
			this.start();
		}, delay);
	}

	async restart(): Promise<void> {
		await this.stop();
		this.restartAttempts = 0;
		this.stopping = false;
		this.start();
	}

	async stop(timeoutMs = 4000): Promise<void> {
		this.stopping = true;
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = null;
		}
		const child = this.child;
		if (!child) return;
		if (child.exitCode !== null || child.signalCode !== null) {
			this.child = null;
			return;
		}

		await new Promise<void>((resolve) => {
			let settled = false;
			const done = () => {
				if (settled) return;
				settled = true;
				resolve();
			};

			child.once("exit", done);

			// Closing stdin asks pi for an orderly shutdown.
			try {
				child.stdin?.end();
			} catch {
				/* ignore */
			}

			const timer = setTimeout(() => {
				killTree(child);
				setTimeout(done, 500);
			}, timeoutMs);
			timer.unref?.();

			setTimeout(() => {
				clearTimeout(timer);
				done();
			}, timeoutMs + 3000).unref?.();
		});

		this.child = null;
	}

	private emitError(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.handlers.stderr(`[piwebui] ${message}`);
	}
}

function killTree(child: ChildProcess): void {
	if (!child.pid) return;
	if (isWindows) {
		exec(`taskkill /pid ${child.pid} /T /F`, () => {
			/* best effort */
		});
		return;
	}
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		try {
			child.kill("SIGKILL");
		} catch {
			/* ignore */
		}
	}
}

function winQuote(arg: string): string {
	if (!/[\s"&|<>^%]/.test(arg)) return arg;
	return `"${arg.replace(/"/g, '\\"')}"`;
}
