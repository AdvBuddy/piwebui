import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

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

/** Loads .env from the server package root (works in both src/ and dist/). */
const envFile = path.resolve(here, "..", ".env");
const fileEnv = readEnvFile(envFile);
const get = (key: string): string | undefined => process.env[key] ?? fileEnv[key];

function bool(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined || value === "") return fallback;
	return /^(1|true|yes|on)$/i.test(value.trim());
}

const accessToken = get("ACCESS_TOKEN") ?? "";
const agentSecret = get("AGENT_SECRET") ?? "";
const sessionSecret = get("SESSION_SECRET") ?? "";

export interface ServerConfig {
	port: number;
	host: string;
	accessToken: string;
	agentSecret: string;
	sessionSecret: string;
	cookieName: string;
	sessionTtlMs: number;
	secureCookies: boolean;
	whisperUrl: string;
	whisperToken: string;
	publicDir: string;
	maxUploadBytes: number;
	trustProxy: boolean;
}

export const config: ServerConfig = {
	port: Number(get("PORT") ?? 8787),
	host: get("HOST") ?? "127.0.0.1",
	accessToken,
	agentSecret,
	sessionSecret: sessionSecret || `${accessToken}::piwebui-session`,
	cookieName: get("COOKIE_NAME") ?? "piwebui_session",
	sessionTtlMs: Number(get("SESSION_TTL_DAYS") ?? 30) * 24 * 60 * 60 * 1000,
	secureCookies: bool(get("SECURE_COOKIES"), false),
	whisperUrl: get("WHISPER_URL") ?? "http://127.0.0.1:8001",
	whisperToken: get("WHISPER_TOKEN") ?? "",
	publicDir: path.resolve(here, "..", get("PUBLIC_DIR") ?? "public"),
	maxUploadBytes: Number(get("MAX_UPLOAD_MB") ?? 25) * 1024 * 1024,
	trustProxy: bool(get("TRUST_PROXY"), true),
};

export function validateConfig(): string[] {
	const problems: string[] = [];
	if (!config.accessToken) problems.push("ACCESS_TOKEN is empty — nobody could log in");
	if (config.accessToken && config.accessToken.length < 16) {
		problems.push("ACCESS_TOKEN is shorter than 16 chars — use at least 32 random bytes");
	}
	if (!config.agentSecret) problems.push("AGENT_SECRET is empty — the local agent-host could never attach");
	if (!fs.existsSync(config.publicDir)) {
		problems.push(`public dir not found: ${config.publicDir} (run \`npm run build:web\` first)`);
	}
	return problems;
}
