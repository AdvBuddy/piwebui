import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import type { SessionSummary } from "@piwebui/shared";

interface SessionHeader {
	type: "session";
	version?: number;
	id: string;
	timestamp: string;
	cwd: string;
	name?: string;
}

/**
 * pi stores sessions as `~/.pi/agent/sessions/--<encoded-cwd>--/<ts>_<id>.jsonl`.
 * There is no RPC command to enumerate them, so we scan the directory ourselves.
 *
 * Sessions from every working directory are returned; `options.cwd` only affects
 * ordering so the current project floats to the top of the list.
 */
export async function listSessions(
	sessionDir: string,
	options: { cwd?: string; limit?: number } = {},
): Promise<SessionSummary[]> {
	const limit = options.limit ?? 50;
	let entries: string[];
	try {
		entries = await fs.readdir(sessionDir);
	} catch {
		return [];
	}

	const candidates: { file: string; mtimeMs: number; size: number }[] = [];

	for (const entry of entries) {
		const dirPath = path.join(sessionDir, entry);
		let stat;
		try {
			stat = await fs.stat(dirPath);
		} catch {
			continue;
		}
		if (!stat.isDirectory()) continue;

		let files: string[];
		try {
			files = await fs.readdir(dirPath);
		} catch {
			continue;
		}
		for (const file of files) {
			if (!file.endsWith(".jsonl")) continue;
			const filePath = path.join(dirPath, file);
			try {
				const fileStat = await fs.stat(filePath);
				candidates.push({ file: filePath, mtimeMs: fileStat.mtimeMs, size: fileStat.size });
			} catch {
				/* ignore */
			}
		}
	}

	candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

	const summaries: SessionSummary[] = [];
	// Parse a few extra so the final page stays filled after any filtering.
	const inspected = candidates.slice(0, Math.max(limit * 3, 60));

	for (const candidate of inspected) {
		if (summaries.length >= limit * 2) break;
		const summary = await readSummary(candidate.file, candidate.mtimeMs, candidate.size);
		if (!summary) continue;
		summaries.push(summary);
	}

	const normalize = (value: string) => path.normalize(value).toLowerCase();
	const currentCwd = options.cwd ? normalize(options.cwd) : null;

	// Current project first (newest first), then everything else by recency.
	summaries.sort((a, b) => {
		const aCurrent = currentCwd !== null && normalize(a.cwd) === currentCwd ? 1 : 0;
		const bCurrent = currentCwd !== null && normalize(b.cwd) === currentCwd ? 1 : 0;
		if (aCurrent !== bCurrent) return bCurrent - aCurrent;
		return b.updatedAt - a.updatedAt;
	});

	return summaries.slice(0, limit);
}

/** Reads just the header line of a session file to learn its working directory. */
export async function readSessionHeader(
	file: string,
): Promise<{ id: string; cwd: string; timestamp: string; name?: string } | null> {
	let handle: FileHandle | null = null;
	try {
		handle = await fs.open(file, "r");
		const buffer = Buffer.alloc(4096);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const firstLine = buffer.subarray(0, bytesRead).toString("utf8").split("\n")[0];
		const record = JSON.parse(firstLine) as Record<string, unknown>;
		if (record.type !== "session" || typeof record.cwd !== "string") return null;
		return {
			id: String(record.id ?? ""),
			cwd: record.cwd,
			timestamp: String(record.timestamp ?? ""),
			name: typeof record.name === "string" ? record.name : undefined,
		};
	} catch {
		return null;
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

/**
 * Session files can get large and there may be hundreds of them, so summaries are
 * cached keyed by path + mtime. Only changed files are re-parsed.
 */
const summaryCache = new Map<string, { mtimeMs: number; size: number; summary: SessionSummary }>();

async function readSummary(file: string, mtimeMs: number, size: number): Promise<SessionSummary | null> {
	const cached = summaryCache.get(file);
	if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
		return cached.summary;
	}

	let raw: string;
	try {
		raw = await fs.readFile(file, "utf8");
	} catch {
		return null;
	}

	const lines = raw.split(/\r?\n/);
	let header: SessionHeader | null = null;
	let messageCount = 0;
	let preview = "";
	let name: string | undefined;
	let firstUserText: string | null = null;

	for (const line of lines) {
		if (!line) continue;
		let record: Record<string, unknown>;
		try {
			record = JSON.parse(line) as Record<string, unknown>;
		} catch {
			continue;
		}
		const type = record.type;
		if (type === "session") {
			header = record as unknown as SessionHeader;
			if (typeof record.name === "string") name = record.name;
			continue;
		}
		if (type === "session_info") {
			if (typeof record.name === "string" && record.name) name = record.name;
			continue;
		}
		if (type === "message") {
			messageCount += 1;
			const message = record.message as { role?: string; content?: unknown } | undefined;
			if (firstUserText === null && message?.role === "user") {
				firstUserText = extractText(message.content);
			}
		}
	}

	if (!header) return null;
	preview = (firstUserText ?? "").replace(/\s+/g, " ").trim().slice(0, 160);

	const summary: SessionSummary = {
		path: file,
		id: header.id ?? path.basename(file, ".jsonl"),
		name: name || undefined,
		cwd: header.cwd ?? "",
		updatedAt: mtimeMs,
		messageCount,
		preview: preview.length > 0 ? preview : "(empty session)",
		sizeBytes: size,
	};

	summaryCache.set(file, { mtimeMs, size, summary });
	// Bound the cache; oldest first since Map preserves insertion order.
	if (summaryCache.size > 500) {
		const oldest = summaryCache.keys().next().value;
		if (oldest !== undefined) summaryCache.delete(oldest);
	}

	return summary;
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
			const text = (block as { text?: string }).text;
			if (typeof text === "string") parts.push(text);
		}
	}
	return parts.join(" ");
}
