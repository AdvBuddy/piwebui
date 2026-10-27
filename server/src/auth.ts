import crypto from "node:crypto";
import type { Context } from "hono";
import { config } from "./config.js";

/**
 * Minimal stateless session: `exp` timestamp + HMAC. No server-side store, no JWT
 * library. Revoking a session means rotating SESSION_SECRET.
 */
function sign(exp: number): string {
	const payload = String(exp);
	const mac = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
	return `${payload}.${mac}`;
}

export function issueSession(): { value: string; maxAge: number } {
	const exp = Date.now() + config.sessionTtlMs;
	return { value: sign(exp), maxAge: Math.floor(config.sessionTtlMs / 1000) };
}

export function verifySession(value: string | undefined): boolean {
	if (!value) return false;
	const dot = value.lastIndexOf(".");
	if (dot <= 0) return false;
	const payload = value.slice(0, dot);
	const provided = value.slice(dot + 1);
	const expected = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	if (a.length !== b.length) return false;
	if (!crypto.timingSafeEqual(a, b)) return false;
	const exp = Number(payload);
	if (!Number.isFinite(exp) || exp < Date.now()) return false;
	return true;
}

export function safeEqual(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	if (bufA.length !== bufB.length) {
		// Still burn a comparison so length isn't trivially leaked via timing.
		crypto.timingSafeEqual(bufA, bufA);
		return false;
	}
	return crypto.timingSafeEqual(bufA, bufB);
}

export function parseCookies(header: string | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!header) return out;
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) continue;
		const key = part.slice(0, eq).trim();
		const value = part.slice(eq + 1).trim();
		if (!key) continue;
		out[key] = decodeURIComponent(value);
	}
	return out;
}

export function readSessionFromRequest(c: Context): string | undefined {
	return parseCookies(c.req.header("cookie"))[config.cookieName];
}

export function isAuthenticated(c: Context): boolean {
	return verifySession(readSessionFromRequest(c));
}

export function buildCookie(value: string, maxAge: number): string {
	const parts = [
		`${config.cookieName}=${encodeURIComponent(value)}`,
		"Path=/",
		`Max-Age=${maxAge}`,
		"HttpOnly",
		"SameSite=Lax",
	];
	if (config.secureCookies) parts.push("Secure");
	return parts.join("; ");
}

export function clearCookie(): string {
	const parts = [`${config.cookieName}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax"];
	if (config.secureCookies) parts.push("Secure");
	return parts.join("; ");
}

/** Simple in-memory brute-force damper for the login endpoint. */
const attempts = new Map<string, { count: number; resetAt: number }>();

export function throttleLogin(key: string): { blocked: boolean; retryAfterSec: number } {
	const now = Date.now();
	const entry = attempts.get(key);
	if (entry && entry.resetAt > now && entry.count >= 8) {
		return { blocked: true, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
	}
	if (!entry || entry.resetAt <= now) {
		attempts.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
	} else {
		entry.count += 1;
	}
	// Opportunistic cleanup so the map cannot grow unbounded.
	if (attempts.size > 5000) {
		for (const [k, v] of attempts) {
			if (v.resetAt <= now) attempts.delete(k);
		}
	}
	return { blocked: false, retryAfterSec: 0 };
}
