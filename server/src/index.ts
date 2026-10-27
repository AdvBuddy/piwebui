import fsp from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { WebSocketServer } from "ws";
import type { TranscribeResponse } from "@piwebui/shared";
import { config, validateConfig } from "./config.js";
import {
	buildCookie,
	clearCookie,
	isAuthenticated,
	issueSession,
	safeEqual,
	throttleLogin,
	verifySession,
} from "./auth.js";
import { hub } from "./hub.js";

const VERSION = "0.1.0";

const problems = validateConfig();
if (problems.length > 0) {
	process.stderr.write(`[server] config problems:\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
	if (!config.accessToken || !config.agentSecret) process.exit(1);
}

const app = new Hono();

/* ------------------------------------------------------------------ */
/* security headers                                                     */
/* ------------------------------------------------------------------ */

app.use("*", async (c, next) => {
	await next();
	c.header("X-Content-Type-Options", "nosniff");
	c.header("Referrer-Policy", "no-referrer");
	c.header("X-Frame-Options", "DENY");
	c.header(
		"Content-Security-Policy",
		[
			"default-src 'self'",
			"script-src 'self'",
			"style-src 'self' 'unsafe-inline'",
			"img-src 'self' data: blob:",
			"media-src 'self' blob:",
			"connect-src 'self' ws: wss:",
			"font-src 'self' data:",
			"object-src 'none'",
			"base-uri 'none'",
			"form-action 'self'",
		].join("; "),
	);
});

/* ------------------------------------------------------------------ */
/* auth                                                                 */
/* ------------------------------------------------------------------ */

app.post("/api/login", async (c) => {
	const ip = clientIp(c);
	const gate = throttleLogin(ip);
	if (gate.blocked) {
		c.header("Retry-After", String(gate.retryAfterSec));
		return c.json({ error: "尝试过于频繁，请稍后再试" }, 429);
	}

	let token = "";
	try {
		const body = (await c.req.json()) as { token?: string };
		token = typeof body.token === "string" ? body.token.trim() : "";
	} catch {
		return c.json({ error: "请求格式错误" }, 400);
	}

	if (!token || !config.accessToken || !safeEqual(token, config.accessToken)) {
		return c.json({ error: "访问令牌不正确" }, 401);
	}

	const session = issueSession();
	c.header("Set-Cookie", buildCookie(session.value, session.maxAge));
	return c.json({ ok: true });
});

app.post("/api/logout", (c) => {
	c.header("Set-Cookie", clearCookie());
	return c.json({ ok: true });
});

app.get("/api/status", (c) => {
	const authenticated = isAuthenticated(c);
	return c.json({
		authenticated,
		agentOnline: hub.agentOnline,
		cwd: authenticated ? hub.agentCwd : null,
		version: VERSION,
	});
});

/* ------------------------------------------------------------------ */
/* authenticated API                                                    */
/* ------------------------------------------------------------------ */

const api = new Hono();

api.use("*", async (c, next) => {
	if (!isAuthenticated(c)) return c.json({ error: "未登录" }, 401);
	await next();
});

api.get("/agent", (c) =>
	c.json({
		online: hub.agentOnline,
		cwd: hub.agentCwd,
		browsers: hub.browserCount,
	}),
);

api.post("/transcribe", async (c) => {
	let form: Record<string, string | File>;
	try {
		form = (await c.req.parseBody()) as Record<string, string | File>;
	} catch {
		return c.json({ error: "无法解析上传内容" }, 400);
	}

	const audio = form["audio"];
	if (!(audio instanceof File)) {
		return c.json({ error: "缺少 audio 文件" }, 400);
	}
	if (audio.size === 0) {
		return c.json({ error: "音频为空" }, 400);
	}
	if (audio.size > config.maxUploadBytes) {
		return c.json({ error: `音频超过 ${Math.round(config.maxUploadBytes / 1024 / 1024)}MB` }, 413);
	}

	const upstream = new FormData();
	upstream.append("audio", audio, audio.name || "speech.webm");
	const language = typeof form["language"] === "string" ? form["language"] : "";
	if (language) upstream.append("language", language);

	const headers: Record<string, string> = {};
	if (config.whisperToken) headers["authorization"] = `Bearer ${config.whisperToken}`;

	const started = Date.now();
	try {
		const response = await fetch(`${config.whisperUrl.replace(/\/$/, "")}/transcribe`, {
			method: "POST",
			body: upstream,
			headers,
			signal: AbortSignal.timeout(180_000),
		});

		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			process.stderr.write(`[server] whisper ${response.status}: ${detail.slice(0, 300)}\n`);
			return c.json({ error: `转写服务返回 ${response.status}` }, 502);
		}

		const payload = (await response.json()) as Partial<TranscribeResponse>;
		const result: TranscribeResponse = {
			text: (payload.text ?? "").trim(),
			language: payload.language,
			durationMs: payload.durationMs ?? Date.now() - started,
			model: payload.model,
		};
		return c.json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`[server] whisper unreachable: ${message}\n`);
		return c.json({ error: "转写服务不可用，检查 faster-whisper 是否已启动" }, 502);
	}
});

api.get("/health", (c) => c.json({ ok: true, agentOnline: hub.agentOnline, version: VERSION }));

app.route("/api", api);

/* ------------------------------------------------------------------ */
/* static SPA                                                           */
/* ------------------------------------------------------------------ */

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".map": "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json",
};

app.get("*", async (c) => {
	const url = new URL(c.req.url);
	let pathname = decodeURIComponent(url.pathname);
	if (pathname === "/") pathname = "/index.html";

	const resolved = path.resolve(config.publicDir, `.${pathname}`);
	// Path traversal guard: the resolved path must stay inside publicDir.
	if (!resolved.startsWith(config.publicDir)) {
		return c.text("forbidden", 403);
	}

	const file = await readIfExists(resolved);
	if (file) return sendFile(c, resolved, file);

	// SPA fallback for client-side routes (but never for asset-looking paths).
	if (!path.extname(pathname)) {
		const indexFile = await readIfExists(path.join(config.publicDir, "index.html"));
		if (indexFile) return sendFile(c, path.join(config.publicDir, "index.html"), indexFile);
	}

	return c.text("not found", 404);
});

async function readIfExists(file: string): Promise<Buffer | null> {
	try {
		const stat = await fsp.stat(file);
		if (!stat.isFile()) return null;
		return await fsp.readFile(file);
	} catch {
		return null;
	}
}

function sendFile(c: Context, filePath: string, content: Buffer) {
	const ext = path.extname(filePath).toLowerCase();
	const isHashedAsset = /\/assets\/.+-[A-Za-z0-9_-]{8,}\./.test(filePath);
	c.header("Content-Type", MIME[ext] ?? "application/octet-stream");
	c.header("Cache-Control", isHashedAsset ? "public, max-age=31536000, immutable" : "no-cache");
	return c.body(new Uint8Array(content));
}

/* ------------------------------------------------------------------ */
/* http + websocket server                                              */
/* ------------------------------------------------------------------ */

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host });

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024, perMessageDeflate: false });

server.on("upgrade", (req, socket, head) => {
	const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
	const pathname = url.pathname;

	if (pathname === "/ws") {
		// Browser channel: cookie-authenticated during the HTTP upgrade so an
		// unauthenticated socket never reaches the hub.
		const cookie = req.headers.cookie;
		const session = cookie ? parseCookieHeader(cookie, config.cookieName) : undefined;
		if (!session || !isAuthenticatedRaw(session)) {
			socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}
		wss.handleUpgrade(req, socket, head, (ws) => hub.attachBrowser(ws));
		return;
	}

	if (pathname === "/agent") {
		// Agent channel: authenticated by the first `hello` frame (secret never goes
		// into a URL, so it never lands in nginx access logs).
		wss.handleUpgrade(req, socket, head, (ws) => hub.attachAgent(ws));
		return;
	}

	socket.destroy();
});

function parseCookieHeader(header: string, name: string): string | undefined {
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) continue;
		if (part.slice(0, eq).trim() === name) {
			return decodeURIComponent(part.slice(eq + 1).trim());
		}
	}
	return undefined;
}

function isAuthenticatedRaw(value: string): boolean {
	// Re-uses the same HMAC verification as the HTTP side without needing a Context.
	return verifySession(value);
}

function clientIp(c: Context): string {
	const forwarded = c.req.header("x-forwarded-for");
	if (config.trustProxy && forwarded) return forwarded.split(",")[0].trim();
	const real = c.req.header("x-real-ip");
	if (config.trustProxy && real) return real.trim();
	return c.req.header("x-forwarded-for") ?? "unknown";
}

/* ------------------------------------------------------------------ */
/* lifecycle                                                            */
/* ------------------------------------------------------------------ */

process.stderr.write(
	[
		`[server] piwebui relay v${VERSION}`,
		`  listen    : http://${config.host}:${config.port}`,
		`  publicDir : ${config.publicDir}`,
		`  whisper   : ${config.whisperUrl}`,
		`  agent     : ${hub.agentOnline ? "online" : "waiting for agent-host"}`,
		"",
	].join("\n"),
);

let shuttingDown = false;
function shutdown(signal: string): void {
	if (shuttingDown) return;
	shuttingDown = true;
	process.stderr.write(`[server] ${signal} received, closing\n`);
	hub.shutdown();
	wss.close();
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (error) => {
	process.stderr.write(`[server] uncaught: ${error.stack ?? String(error)}\n`);
});
process.on("unhandledRejection", (reason) => {
	process.stderr.write(`[server] unhandled rejection: ${String(reason)}\n`);
});
