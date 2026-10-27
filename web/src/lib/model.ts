import type {
	AgentMessage,
	AssistantMessage,
	ImageContent,
	TextContent,
	ToolResultMessage,
	Usage,
} from "@piwebui/shared";

/* ------------------------------------------------------------------ */
/* UI model                                                            */
/* ------------------------------------------------------------------ */

export interface TextBlock {
	kind: "text";
	text: string;
	streaming?: boolean;
}

export interface ThinkingBlock {
	kind: "thinking";
	text: string;
	streaming?: boolean;
	redacted?: boolean;
}

export type ToolStatus = "streaming" | "pending" | "running" | "ok" | "error";

export interface ToolBlock {
	kind: "toolCall";
	id: string;
	name: string;
	args: Record<string, unknown>;
	/** Raw JSON as it streams in, before the full object is known. */
	argsRaw: string;
	status: ToolStatus;
	output?: string;
	outputImages?: string[];
	durationMs?: number;
	startedAt?: number;
}

export interface NoticeBlock {
	kind: "notice";
	text: string;
	tone: "info" | "warn" | "error";
}

export type Block = TextBlock | ThinkingBlock | ToolBlock | NoticeBlock;

export interface Attachment {
	id: string;
	mimeType: string;
	/** base64 without the data: prefix */
	data: string;
	name?: string;
	width?: number;
	height?: number;
}

export interface UiMessage {
	key: string;
	role: "user" | "assistant" | "bash" | "custom" | "summary";
	blocks: Block[];
	timestamp: number;
	streaming?: boolean;
	stopReason?: string;
	usage?: Usage;
	model?: string;
	error?: string;
	attachments?: Attachment[];
	/** Set while a user message is optimistically rendered and not yet echoed by pi. */
	pending?: boolean;
	durationMs?: number;
	/**
	 * Maps a streaming `contentIndex` to the index inside `blocks`.
	 *
	 * This must live on the message object itself: the reducer replaces the message
	 * on every delta, so any WeakMap keyed by object identity would go stale and
	 * spawn a fresh block per token.
	 */
	blockIndex?: Record<number, number>;
}

export interface PiState {
	model?: { provider: string; id: string; name?: string; contextWindow?: number; input?: string[] };
	thinkingLevel?: string;
	isStreaming?: boolean;
	isCompacting?: boolean;
	sessionId?: string;
	sessionFile?: string;
	sessionName?: string;
	messageCount?: number;
	pendingMessageCount?: number;
	autoCompactionEnabled?: boolean;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

let seq = 0;
export function nextKey(prefix = "m"): string {
	seq += 1;
	return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object" && (block as TextContent).type === "text") {
			const text = (block as TextContent).text;
			if (typeof text === "string") parts.push(text);
		}
	}
	return parts.join("\n");
}

export function extractImages(content: unknown): Attachment[] {
	if (!Array.isArray(content)) return [];
	const out: Attachment[] = [];
	for (const block of content) {
		if (block && typeof block === "object" && (block as ImageContent).type === "image") {
			const image = block as ImageContent;
			out.push({
				id: nextKey("img"),
				mimeType: image.mimeType || "image/png",
				data: image.data,
			});
		}
	}
	return out;
}

export function attachmentsToImageContent(attachments: Attachment[]): ImageContent[] {
	return attachments.map((a) => ({ type: "image" as const, data: a.data, mimeType: a.mimeType }));
}

/* ------------------------------------------------------------------ */
/* AgentMessage -> UiMessage                                           */
/* ------------------------------------------------------------------ */

export function assistantMessageToUi(message: AssistantMessage, key?: string): UiMessage {
	const blocks: Block[] = [];
	for (const block of message.content ?? []) {
		if (!block || typeof block !== "object") continue;
		switch (block.type) {
			case "text":
				if (block.text) blocks.push({ kind: "text", text: block.text });
				break;
			case "thinking":
				if (block.thinking) {
					blocks.push({ kind: "thinking", text: block.thinking, redacted: block.redacted });
				}
				break;
			case "toolCall":
				blocks.push({
					kind: "toolCall",
					id: block.id,
					name: block.name,
					args: block.arguments ?? {},
					argsRaw: "",
					status: "pending",
				});
				break;
		}
	}

	return {
		key: key ?? nextKey("a"),
		role: "assistant",
		blocks,
		timestamp: message.timestamp ?? Date.now(),
		stopReason: message.stopReason,
		usage: message.usage,
		model: message.model,
		error: message.stopReason === "error" ? (message.errorMessage ?? "模型返回错误") : undefined,
	};
}

export function userMessageToUi(message: AgentMessage & { role: "user" }): UiMessage {
	const text = extractText(message.content);
	return {
		key: nextKey("u"),
		role: "user",
		blocks: text ? [{ kind: "text", text }] : [],
		attachments: extractImages(message.content),
		timestamp: message.timestamp ?? Date.now(),
	};
}

/**
 * Rebuilds the visible timeline from pi's authoritative message list.
 * Tool results are folded back into the tool-call blocks that produced them.
 */
export function buildTimeline(messages: AgentMessage[]): UiMessage[] {
	const out: UiMessage[] = [];
	const toolIndex = new Map<string, ToolBlock>();

	for (const message of messages) {
		if (!message || typeof message !== "object") continue;

		switch (message.role) {
			case "system":
				continue;

			case "user": {
				const text = extractText(message.content);
				const images = extractImages(message.content);
				if (!text && images.length === 0) continue;
				out.push({
					key: nextKey("u"),
					role: "user",
					blocks: text ? [{ kind: "text", text }] : [],
					attachments: images.length ? images : undefined,
					timestamp: message.timestamp ?? Date.now(),
				});
				break;
			}

			case "assistant": {
				const ui = assistantMessageToUi(message);
				if (ui.blocks.length === 0 && !ui.error) continue;
				for (const block of ui.blocks) {
					if (block.kind === "toolCall") toolIndex.set(block.id, block);
				}
				out.push(ui);
				break;
			}

			case "toolResult": {
				const result = message as ToolResultMessage;
				const target = toolIndex.get(result.toolCallId);
				const { text, images } = splitToolContent(result.content);
				if (target) {
					target.output = text;
					target.outputImages = images.length ? images : undefined;
					target.status = result.isError ? "error" : "ok";
				}
				break;
			}

			case "bashExecution": {
				out.push({
					key: nextKey("b"),
					role: "bash",
					blocks: [
						{
							kind: "text",
							text: message.command,
						},
						{
							kind: "text",
							text: message.output ?? "",
						},
					],
					timestamp: message.timestamp ?? Date.now(),
				});
				break;
			}

			case "compactionSummary": {
				out.push({
					key: nextKey("s"),
					role: "summary",
					blocks: [
						{
							kind: "notice",
							text: `上下文已压缩（压缩前约 ${Math.round((message.tokensBefore ?? 0) / 1000)}k tokens）`,
							tone: "info",
						},
					],
					timestamp: message.timestamp ?? Date.now(),
				});
				break;
			}

			case "branchSummary": {
				out.push({
					key: nextKey("s"),
					role: "summary",
					blocks: [{ kind: "notice", text: `分支摘要：${message.summary}`, tone: "info" }],
					timestamp: message.timestamp ?? Date.now(),
				});
				break;
			}

			case "custom": {
				const text = extractText(message.content);
				if (!message.display || !text) continue;
				out.push({
					key: nextKey("c"),
					role: "custom",
					blocks: [{ kind: "text", text }],
					timestamp: message.timestamp ?? Date.now(),
				});
				break;
			}

			default:
				continue;
		}
	}

	return out;
}

export function splitToolContent(content: unknown): { text: string; images: string[] } {
	const images: string[] = [];
	if (!Array.isArray(content)) return { text: "", images };
	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		if ((block as TextContent).type === "text") {
			parts.push((block as TextContent).text);
		} else if ((block as ImageContent).type === "image") {
			images.push(`data:${(block as ImageContent).mimeType};base64,${(block as ImageContent).data}`);
		}
	}
	return { text: parts.join("\n"), images };
}

/* ------------------------------------------------------------------ */
/* tool argument summarising                                           */
/* ------------------------------------------------------------------ */

export interface ToolPresentation {
	title: string;
	subtitle?: string;
	/** "bash" | "edit" | "write" | "read" | "grep" | "generic" */
	flavor: string;
	preview?: string;
}

const MAX_PREVIEW = 160;

export function presentTool(name: string, args: Record<string, unknown> | undefined): ToolPresentation {
	const a = args ?? {};
	const str = (k: string): string => (typeof a[k] === "string" ? (a[k] as string) : "");

	switch (name) {
		case "bash": {
			const command = str("command");
			return {
				title: "执行命令",
				subtitle: truncate(command, MAX_PREVIEW),
				flavor: "bash",
				preview: command,
			};
		}
		case "read": {
			const file = str("path") || str("file_path") || str("file");
			return { title: "读取文件", subtitle: file, flavor: "read" };
		}
		case "write": {
			const file = str("path") || str("file_path") || str("file");
			const content = str("content");
			return {
				title: "写入文件",
				subtitle: file,
				flavor: "write",
				preview: content ? `${content.split("\n").length} 行` : undefined,
			};
		}
		case "edit": {
			const file = str("path") || str("file_path") || str("file");
			return { title: "编辑文件", subtitle: file, flavor: "edit" };
		}
		case "grep":
		case "search": {
			const pattern = str("pattern") || str("query");
			return { title: "搜索", subtitle: pattern, flavor: "grep" };
		}
		case "glob":
		case "ls":
		case "list": {
			const pattern = str("pattern") || str("path");
			return { title: "列目录", subtitle: pattern, flavor: "glob" };
		}
		case "web_search":
		case "websearch": {
			return { title: "网络搜索", subtitle: str("query"), flavor: "web" };
		}
		case "web_fetch":
		case "webfetch": {
			return { title: "抓取网页", subtitle: str("url"), flavor: "web" };
		}
		default: {
			const entries = Object.entries(a);
			const first = entries.find(([, v]) => typeof v === "string");
			return {
				title: name,
				subtitle: first ? truncate(String(first[1]), MAX_PREVIEW) : undefined,
				flavor: "generic",
			};
		}
	}
}

export function truncate(value: string, max: number): string {
	const collapsed = value.replace(/\s+/g, " ").trim();
	return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

/** Produces a unified-diff-ish view from before/after strings for the edit tool. */
export function diffLines(before: string, after: string): { type: " " | "+" | "-"; text: string }[] {
	const a = before.split("\n");
	const b = after.split("\n");
	// Simple LCS on lines; tool payloads are small, but guard against pathological
	// sizes where O(n*m) memory would hurt.
	if (a.length * b.length > 400_000) {
		return [
			...a.map((text) => ({ type: "-" as const, text })),
			...b.map((text) => ({ type: "+" as const, text })),
		];
	}
	const n = a.length;
	const m = b.length;
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i -= 1) {
		for (let j = m - 1; j >= 0; j -= 1) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}
	const out: { type: " " | "+" | "-"; text: string }[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			out.push({ type: " ", text: a[i] });
			i += 1;
			j += 1;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			out.push({ type: "-", text: a[i] });
			i += 1;
		} else {
			out.push({ type: "+", text: b[j] });
			j += 1;
		}
	}
	while (i < n) out.push({ type: "-", text: a[i++] });
	while (j < m) out.push({ type: "+", text: b[j++] });
	return out;
}

export function extractToolDiff(name: string, args: Record<string, unknown> | undefined) {
	if (name !== "edit" || !args) return null;
	const before = typeof args.old_string === "string" ? args.old_string : typeof args.oldText === "string" ? args.oldText : "";
	const after = typeof args.new_string === "string" ? args.new_string : typeof args.newText === "string" ? args.newText : "";
	if (!before && !after) return null;
	return diffLines(before, after);
}
