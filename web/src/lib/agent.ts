import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type {
	AgentMessage,
	AssistantMessage,
	ClientToAgent,
	ExtensionUIRequest,
	PiCommand,
	PiResponse,
	ServerFrame,
	SessionEvent,
	SessionSummary,
	ToolResultMessage,
} from "@piwebui/shared";
import {
	assistantMessageToUi,
	buildTimeline,
	extractImages,
	extractText,
	nextKey,
	splitToolContent,
	type Attachment,
	type Block,
	type PiState,
	type ToolBlock,
	type UiMessage,
} from "./model";

/* ------------------------------------------------------------------ */
/* store                                                               */
/* ------------------------------------------------------------------ */

export interface Toast {
	id: string;
	message: string;
	tone: "info" | "warn" | "error";
}

export interface AgentStore {
	connected: boolean;
	agentOnline: boolean;
	cwd: string | null;
	host: string | null;
	piProcessState: "starting" | "ready" | "exited" | "unknown";
	messages: UiMessage[];
	activeAssistantKey: string | null;
	pendingUserCount: number;
	busy: boolean;
	queue: { steering: string[]; followUp: string[] };
	state: PiState;
	availableModels: { provider: string; id: string; name?: string; [k: string]: unknown }[];
	thinkingLevels: string[];
	sessions: SessionSummary[];
	sessionsLoading: boolean;
	extensionQueue: ExtensionUIRequest[];
	toasts: Toast[];
	stderr: string[];
	compaction: { active: boolean; reason?: string };
	lastError: string | null;
}

const initialState: AgentStore = {
	connected: false,
	agentOnline: false,
	cwd: null,
	host: null,
	piProcessState: "unknown",
	messages: [],
	activeAssistantKey: null,
	pendingUserCount: 0,
	busy: false,
	queue: { steering: [], followUp: [] },
	state: {},
	availableModels: [],
	thinkingLevels: [],
	sessions: [],
	sessionsLoading: false,
	extensionQueue: [],
	toasts: [],
	stderr: [],
	compaction: { active: false },
	lastError: null,
};

type Action =
	| { type: "connection"; connected: boolean; agentOnline?: boolean; cwd?: string | null }
	| { type: "agent_status"; online: boolean; cwd?: string | null }
	| { type: "history"; messages: AgentMessage[] }
	| { type: "event"; event: SessionEvent }
	| { type: "response"; response: PiResponse }
	| { type: "optimistic-user"; message: UiMessage }
	| { type: "extension"; request: ExtensionUIRequest }
	| { type: "extension-done"; id: string }
	| { type: "toast"; toast: Toast }
	| { type: "dismiss-toast"; id: string }
	| { type: "stderr"; line: string }
	| { type: "process"; state: "starting" | "ready" | "exited" }
	| { type: "sessions"; sessions: SessionSummary[] }
	| { type: "sessions-loading"; loading: boolean }
	| { type: "error"; message: string }
	| { type: "clear-error" }
	| { type: "reset-timeline" };

/* ------------------------------------------------------------------ */
/* reducer helpers                                                     */
/* ------------------------------------------------------------------ */

/** contentIndex -> index inside blocks, for the streaming assistant message. */
type BlockIndex = Record<number, number>;

function getBlockIndex(message: UiMessage): BlockIndex {
	return message.blockIndex ?? {};
}

function ensureBlock(
	message: UiMessage,
	contentIndex: number,
	factory: () => Block,
): { message: UiMessage; blockIndex: number } {
	const map = getBlockIndex(message);
	const existing = map[contentIndex];
	if (existing !== undefined && message.blocks[existing]) {
		return { message, blockIndex: existing };
	}
	const blocks = message.blocks.slice();
	blocks.push(factory());
	const blockIndex = blocks.length - 1;
	return { message: { ...message, blocks, blockIndex: { ...map, [contentIndex]: blockIndex } }, blockIndex };
}

function updateBlock(message: UiMessage, blockIndex: number, patch: (b: Block) => Block): UiMessage {
	const blocks = message.blocks.slice();
	if (!blocks[blockIndex]) return message;
	blocks[blockIndex] = patch(blocks[blockIndex]);
	return { ...message, blocks };
}

/* ------------------------------------------------------------------ */
/* reducer                                                             */
/* ------------------------------------------------------------------ */

function reducer(store: AgentStore, action: Action): AgentStore {
	switch (action.type) {
		case "connection":
			return {
				...store,
				connected: action.connected,
				agentOnline: action.agentOnline ?? store.agentOnline,
				cwd: action.cwd ?? store.cwd,
			};

		case "agent_status":
			return { ...store, agentOnline: action.online, cwd: action.cwd ?? store.cwd };

		case "history":
			return {
				...store,
				messages: buildTimeline(action.messages),
				activeAssistantKey: null,
				pendingUserCount: 0,
				busy: false,
			};

		case "reset-timeline":
			return { ...store, messages: [], activeAssistantKey: null, busy: false, pendingUserCount: 0 };

		case "optimistic-user":
			return {
				...store,
				messages: [...store.messages, action.message],
				pendingUserCount: store.pendingUserCount + 1,
			};

		case "process":
			return { ...store, piProcessState: action.state };

		case "stderr":
			return { ...store, stderr: [...store.stderr.slice(-199), action.line] };

		case "extension":
			return { ...store, extensionQueue: [...store.extensionQueue, action.request] };

		case "extension-done":
			return { ...store, extensionQueue: store.extensionQueue.filter((r) => r.id !== action.id) };

		case "toast":
			return { ...store, toasts: [...store.toasts.slice(-4), action.toast] };

		case "dismiss-toast":
			return { ...store, toasts: store.toasts.filter((t) => t.id !== action.id) };

		case "sessions":
			return { ...store, sessions: action.sessions, sessionsLoading: false };

		case "sessions-loading":
			return { ...store, sessionsLoading: action.loading };

		case "error":
			return { ...store, lastError: action.message };

		case "clear-error":
			return { ...store, lastError: null };

		case "response":
			return reduceResponse(store, action.response);

		case "event":
			return reduceEvent(store, action.event);

		default:
			return store;
	}
}

function reduceResponse(store: AgentStore, response: PiResponse): AgentStore {
	if (!response.success) {
		return { ...store, lastError: response.error ?? "命令执行失败" };
	}

	switch (response.command) {
		case "get_state": {
			const data = response.data as Record<string, unknown> | undefined;
			if (!data) return store;
			const model = data.model as PiState["model"] | undefined;
			return {
				...store,
				state: {
					model,
					thinkingLevel: data.thinkingLevel as string | undefined,
					isStreaming: Boolean(data.isStreaming),
					isCompacting: Boolean(data.isCompacting),
					sessionId: data.sessionId as string | undefined,
					sessionFile: data.sessionFile as string | undefined,
					sessionName: data.sessionName as string | undefined,
					messageCount: data.messageCount as number | undefined,
					autoCompactionEnabled: data.autoCompactionEnabled as boolean | undefined,
				},
				busy: Boolean(data.isStreaming),
			};
		}

		case "get_available_models": {
			const data = response.data as { models?: AgentStore["availableModels"] } | undefined;
			return { ...store, availableModels: data?.models ?? [] };
		}

		case "get_available_thinking_levels": {
			const data = response.data as { levels?: string[] } | undefined;
			return { ...store, thinkingLevels: data?.levels ?? [] };
		}

		case "set_model": {
			// `set_model` returns the Model object itself, not a wrapper.
			const data = response.data as PiState["model"] | undefined;
			if (!data?.id) return store;
			return { ...store, state: { ...store.state, model: data } };
		}

		case "cycle_model": {
			// `cycle_model` wraps it: { model, thinkingLevel, isScoped }.
			const data = response.data as { model?: PiState["model"]; thinkingLevel?: string } | undefined;
			if (!data?.model) return store;
			return {
				...store,
				state: {
					...store.state,
					model: data.model,
					thinkingLevel: data.thinkingLevel ?? store.state.thinkingLevel,
				},
			};
		}

		case "set_thinking_level":
		case "cycle_thinking_level": {
			const data = response.data as { level?: string } | undefined;
			const level = data?.level;
			return level ? { ...store, state: { ...store.state, thinkingLevel: level } } : store;
		}

		case "piwebui_list_sessions": {
			const data = response.data as { sessions?: SessionSummary[] } | undefined;
			return { ...store, sessions: data?.sessions ?? [], sessionsLoading: false };
		}

		case "piwebui_get_config": {
			const data = response.data as { host?: string; cwd?: string } | undefined;
			return { ...store, host: data?.host ?? store.host, cwd: data?.cwd ?? store.cwd };
		}

		case "switch_session":
		case "new_session": {
			// The follow-up get_messages / get_state calls re-sync the timeline.
			return store;
		}

		default:
			return store;
	}
}

function reduceEvent(store: AgentStore, event: SessionEvent): AgentStore {
	switch (event.type) {
		case "agent_start":
			return { ...store, busy: true };

		case "agent_end":
			// willRetry means another low-level run follows; stay busy.
			return event.willRetry ? store : { ...store, busy: false };

		case "agent_settled": {
			const messages = store.messages.map((m) => {
				if (!m.streaming) return m;
				return {
					...m,
					streaming: false,
					blocks: m.blocks.map((b) =>
						(b.kind === "text" || b.kind === "thinking") && b.streaming ? { ...b, streaming: false } : b,
					),
				};
			});
			return {
				...store,
				busy: false,
				messages,
				activeAssistantKey: null,
				queue: { steering: [], followUp: [] },
			};
		}

		case "message_start":
			return reduceMessageStart(store, event.message);

		case "message_update":
			return reduceMessageUpdate(store, event);

		case "message_end":
			return reduceMessageEnd(store, event.message);

		case "tool_execution_start":
			return patchTool(store, event.toolCallId, (block) => ({
				...block,
				status: "running",
				args: event.args ?? block.args,
				startedAt: Date.now(),
			}));

		case "tool_execution_update":
			return patchTool(store, event.toolCallId, (block) => {
				const { text } = splitToolContent(event.partialResult?.content);
				return { ...block, status: "running", output: text || block.output };
			});

		case "tool_execution_end":
			return patchTool(store, event.toolCallId, (block) => {
				const { text, images } = splitToolContent(event.result?.content);
				return {
					...block,
					status: event.isError ? "error" : "ok",
					output: text || block.output,
					outputImages: images.length ? images : block.outputImages,
					durationMs: event.durationMs,
				};
			});

		case "queue_update":
			return { ...store, queue: { steering: event.steering ?? [], followUp: event.followUp ?? [] } };

		case "session_info_changed":
			return { ...store, state: { ...store.state, sessionName: event.name } };

		case "thinking_level_changed":
			return { ...store, state: { ...store.state, thinkingLevel: event.level } };

		case "compaction_start":
			return { ...store, compaction: { active: true, reason: event.reason }, busy: true };

		case "compaction_end":
			return { ...store, compaction: { active: false } };

		default:
			return store;
	}
}

function reduceMessageStart(store: AgentStore, message: AgentMessage): AgentStore {
	const role = (message as { role?: string }).role;

	if (role === "user") {
		if (store.pendingUserCount > 0) {
			// pi echoed our optimistic message; keep the local copy and just confirm it.
			const messages = store.messages.slice();
			for (let i = messages.length - 1; i >= 0; i -= 1) {
				if (messages[i].pending) {
					messages[i] = { ...messages[i], pending: false };
					break;
				}
			}
			return { ...store, messages, pendingUserCount: Math.max(0, store.pendingUserCount - 1) };
		}
		const content = (message as { content?: unknown }).content;
		const text = extractText(content);
		const images = extractImages(content);
		if (!text && images.length === 0) return store;
		return {
			...store,
			messages: [
				...store.messages,
				{
					key: nextKey("u"),
					role: "user",
					blocks: text ? [{ kind: "text", text }] : [],
					attachments: images.length ? images : undefined,
					timestamp: message.timestamp ?? Date.now(),
				},
			],
		};
	}

	if (role === "assistant") {
		const assistant = message as AssistantMessage;
		const ui = assistantMessageToUi(assistant);
		ui.streaming = true;
		ui.blockIndex = {};
		return {
			...store,
			messages: [...store.messages, ui],
			activeAssistantKey: ui.key,
			busy: true,
		};
	}

	if (role === "toolResult") {
		const result = message as ToolResultMessage;
		const { text, images } = splitToolContent(result.content);
		const patched = store.messages.map((m) => {
			const index = m.blocks.findIndex((b) => b.kind === "toolCall" && b.id === result.toolCallId);
			if (index === -1) return m;
			const blocks = m.blocks.slice();
			const block = blocks[index] as ToolBlock;
			blocks[index] = {
				...block,
				status: result.isError ? "error" : "ok",
				output: text || block.output,
				outputImages: images.length ? images : block.outputImages,
			};
			return { ...m, blocks };
		});
		return { ...store, messages: patched };
	}

	return store;
}

function reduceMessageUpdate(store: AgentStore, event: Extract<SessionEvent, { type: "message_update" }>): AgentStore {
	const key = store.activeAssistantKey;
	if (!key) return store;
	const delta = event.assistantMessageEvent;
	if (!delta) return store;

	const index = store.messages.findIndex((m) => m.key === key);
	if (index === -1) return store;
	const message = store.messages[index];

	let next = message;

	switch (delta.type) {
		case "text_start": {
			const ensured = ensureBlock(next, delta.contentIndex, () => ({ kind: "text", text: "", streaming: true }));
			next = updateBlock(ensured.message, ensured.blockIndex, (b) =>
				b.kind === "text" ? { ...b, streaming: true } : b,
			);
			break;
		}
		case "text_delta": {
			const ensured = ensureBlock(next, delta.contentIndex, () => ({ kind: "text", text: "", streaming: true }));
			next = updateBlock(ensured.message, ensured.blockIndex, (b) =>
				b.kind === "text" ? { ...b, text: b.text + delta.delta } : b,
			);
			break;
		}
		case "text_end": {
			const ensured = ensureBlock(next, delta.contentIndex, () => ({ kind: "text", text: "", streaming: true }));
			next = updateBlock(ensured.message, ensured.blockIndex, (b) =>
				b.kind === "text" ? { ...b, text: delta.content, streaming: false } : b,
			);
			break;
		}
		case "thinking_start": {
			const ensured = ensureBlock(next, delta.contentIndex, () => ({ kind: "thinking", text: "", streaming: true }));
			next = updateBlock(ensured.message, ensured.blockIndex, (b) =>
				b.kind === "thinking" ? { ...b, streaming: true } : b,
			);
			break;
		}
		case "thinking_delta": {
			const ensured = ensureBlock(next, delta.contentIndex, () => ({ kind: "thinking", text: "", streaming: true }));
			next = updateBlock(ensured.message, ensured.blockIndex, (b) =>
				b.kind === "thinking" ? { ...b, text: b.text + delta.delta } : b,
			);
			break;
		}
		case "thinking_end": {
			const ensured = ensureBlock(next, delta.contentIndex, () => ({ kind: "thinking", text: "", streaming: true }));
			next = updateBlock(ensured.message, ensured.blockIndex, (b) =>
				b.kind === "thinking" ? { ...b, text: delta.content, streaming: false } : b,
			);
			break;
		}
		case "toolcall_start": {
			const ensured = ensureBlock(next, delta.contentIndex, () => ({
				kind: "toolCall",
				id: delta.id,
				name: delta.toolName,
				args: {},
				argsRaw: "",
				status: "streaming",
			}));
			next = ensured.message;
			break;
		}
		case "toolcall_delta": {
			const map = getBlockIndex(next);
			const blockIndex = map[delta.contentIndex];
			if (blockIndex !== undefined) {
				next = updateBlock(next, blockIndex, (b) =>
					b.kind === "toolCall" ? { ...b, argsRaw: b.argsRaw + delta.delta } : b,
				);
			}
			break;
		}
		case "toolcall_end": {
			const map = getBlockIndex(next);
			const blockIndex = map[delta.contentIndex];
			if (blockIndex !== undefined) {
				next = updateBlock(next, blockIndex, (b) =>
					b.kind === "toolCall"
						? {
								...b,
								id: delta.toolCall.id || b.id,
								name: delta.toolCall.name || b.name,
								args: delta.toolCall.arguments ?? b.args,
								argsRaw: "",
								status: "pending",
							}
						: b,
				);
			}
			break;
		}
		default:
			break;
	}

	if (next === message) return store;
	const messages = store.messages.slice();
	messages[index] = next;
	return { ...store, messages };
}

function reduceMessageEnd(store: AgentStore, message: AgentMessage): AgentStore {
	const role = (message as { role?: string }).role;

	if (role === "assistant") {
		const key = store.activeAssistantKey;
		if (!key) return store;
		const index = store.messages.findIndex((m) => m.key === key);
		if (index === -1) return store;
		const previous = store.messages[index];

		const rebuilt = assistantMessageToUi(message as AssistantMessage, key);
		rebuilt.streaming = false;

		// Preserve execution state that arrived via tool_execution_* events.
		const previousTools = new Map<string, ToolBlock>();
		for (const block of previous.blocks) {
			if (block.kind === "toolCall") previousTools.set(block.id, block);
		}
		rebuilt.blocks = rebuilt.blocks.map((block) => {
			if (block.kind !== "toolCall") return block;
			const prev = previousTools.get(block.id);
			if (!prev) return block;
			return {
				...block,
				status: prev.status === "streaming" ? "pending" : prev.status,
				output: prev.output ?? block.output,
				outputImages: prev.outputImages ?? block.outputImages,
				durationMs: prev.durationMs ?? block.durationMs,
				argsRaw: "",
			};
		});
		rebuilt.blockIndex = undefined;

		const messages = store.messages.slice();
		messages[index] = rebuilt;
		return { ...store, messages, activeAssistantKey: null };
	}

	if (role === "user") {
		return store;
	}

	return store;
}

function patchTool(store: AgentStore, toolCallId: string, patch: (block: ToolBlock) => ToolBlock): AgentStore {
	let changed = false;
	const messages = store.messages.map((message) => {
		const index = message.blocks.findIndex((b) => b.kind === "toolCall" && b.id === toolCallId);
		if (index === -1) return message;
		const blocks = message.blocks.slice();
		blocks[index] = patch(blocks[index] as ToolBlock);
		changed = true;
		return { ...message, blocks };
	});
	return changed ? { ...store, messages } : store;
}

/* ------------------------------------------------------------------ */
/* hook                                                                */
/* ------------------------------------------------------------------ */

interface PendingCall {
	resolve: (response: PiResponse) => void;
	timer: number;
}

function wsUrl(): string {
	const protocol = location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${location.host}/ws`;
}

export interface AgentApi {
	store: AgentStore;
	prompt: (text: string, attachments: Attachment[], behavior?: "steer" | "followUp") => void;
	abort: () => void;
	clearQueue: () => Promise<string>;
	newSession: () => Promise<void>;
	switchSession: (sessionPath: string) => Promise<void>;
	refreshSessions: () => void;
	refreshState: () => void;
	setModel: (provider: string, modelId: string) => void;
	setThinkingLevel: (level: string) => void;
	cycleThinkingLevel: () => void;
	renameSession: (name: string) => void;
	compact: () => void;
	restartPi: () => void;
	respondExtension: (id: string, response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
	call: (command: AnyCommand) => Promise<PiResponse>;
	dismissToast: (id: string) => void;
	clearError: () => void;
	toast: (message: string, tone?: Toast["tone"]) => void;
}

type AnyCommand = PiCommand | (Record<string, unknown> & { type: string });

export function useAgent(enabled: boolean): AgentApi {
	const [store, dispatch] = useReducer(reducer, initialState);
	const wsRef = useRef<WebSocket | null>(null);
	const pendingRef = useRef(new Map<string, PendingCall>());
	const retryRef = useRef(0);
	const reconnectTimerRef = useRef<number | null>(null);
	const heartbeatRef = useRef<number | null>(null);
	const disposedRef = useRef(false);
	const enabledRef = useRef(enabled);
	enabledRef.current = enabled;

	const sendRaw = useCallback((record: ClientToAgent) => {
		const ws = wsRef.current;
		if (!ws || ws.readyState !== WebSocket.OPEN) return false;
		ws.send(JSON.stringify({ type: "relay", record }));
		return true;
	}, []);

	const call = useCallback(
		(command: AnyCommand): Promise<PiResponse> => {
			const id = nextKey("req");
			const payload = { ...(command as object), id } as ClientToAgent;
			return new Promise<PiResponse>((resolve) => {
				const timer = window.setTimeout(() => {
					pendingRef.current.delete(id);
					resolve({
						type: "response",
						id,
						command: (command as { type?: string }).type ?? "unknown",
						success: false,
						error: "命令超时（本地 agent 可能未响应）",
					});
				}, 30_000);
				pendingRef.current.set(id, { resolve, timer });
				if (!sendRaw(payload)) {
					window.clearTimeout(timer);
					pendingRef.current.delete(id);
					resolve({
						type: "response",
						id,
						command: (command as { type?: string }).type ?? "unknown",
						success: false,
						error: "未连接到服务器",
					});
				}
			});
		},
		[sendRaw],
	);

	const pushToast = useCallback((message: string, tone: Toast["tone"] = "info") => {
		const toast: Toast = { id: nextKey("t"), message, tone };
		dispatch({ type: "toast", toast });
		window.setTimeout(() => dispatch({ type: "dismiss-toast", id: toast.id }), 4200);
	}, []);

	const refreshState = useCallback(() => {
		void call({ type: "get_state" });
		void call({ type: "get_available_models" });
		void call({ type: "get_available_thinking_levels" });
	}, [call]);

	const refreshSessions = useCallback(() => {
		dispatch({ type: "sessions-loading", loading: true });
		void call({ type: "piwebui_list_sessions", limit: 60 });
	}, [call]);

	const syncHistory = useCallback(async () => {
		const messagesResponse = await call({ type: "get_messages" });
		const messages = (messagesResponse.data as { messages?: AgentMessage[] } | undefined)?.messages;
		if (messages) dispatch({ type: "history", messages });
		void call({ type: "get_state" });
	}, [call]);

	/* -------------------- connection lifecycle -------------------- */

	useEffect(() => {
		if (!enabled) return;
		disposedRef.current = false;

		const connect = () => {
			if (disposedRef.current) return;
			let ws: WebSocket;
			try {
				ws = new WebSocket(wsUrl());
			} catch {
				scheduleReconnect();
				return;
			}
			wsRef.current = ws;

			ws.onopen = () => {
				retryRef.current = 0;
				dispatch({ type: "connection", connected: true });
				heartbeatRef.current = window.setInterval(() => {
					if (ws.readyState === WebSocket.OPEN) {
						ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
					}
				}, 25_000);
				// Rebuild from pi's authoritative session state after every (re)connect.
				void syncHistory();
				void call({ type: "get_available_models" });
				void call({ type: "get_available_thinking_levels" });
				void call({ type: "piwebui_list_sessions", limit: 60 });
				void call({ type: "piwebui_get_config" });
			};

			ws.onmessage = (event) => {
				let frame: ServerFrame;
				try {
					frame = JSON.parse(event.data as string) as ServerFrame;
				} catch {
					return;
				}
				handleFrame(frame);
			};

			ws.onclose = () => {
				cleanupSocket();
				dispatch({ type: "connection", connected: false });
				scheduleReconnect();
			};

			ws.onerror = () => {
				// onclose always follows; nothing to do here.
			};
		};

		const cleanupSocket = () => {
			if (heartbeatRef.current !== null) {
				window.clearInterval(heartbeatRef.current);
				heartbeatRef.current = null;
			}
			wsRef.current = null;
			for (const [, pending] of pendingRef.current) {
				window.clearTimeout(pending.timer);
				pending.resolve({
					type: "response",
					command: "unknown",
					success: false,
					error: "连接已断开",
				});
			}
			pendingRef.current.clear();
		};

		const scheduleReconnect = () => {
			if (disposedRef.current || reconnectTimerRef.current !== null) return;
			const delay = Math.min(800 * 2 ** retryRef.current, 15_000);
			retryRef.current += 1;
			reconnectTimerRef.current = window.setTimeout(() => {
				reconnectTimerRef.current = null;
				connect();
			}, delay);
		};

		const handleFrame = (frame: ServerFrame) => {
			if (frame.type === "hello") {
				dispatch({
					type: "connection",
					connected: true,
					agentOnline: frame.agentOnline,
					cwd: frame.cwd,
				});
				return;
			}
			if (frame.type === "agent_status") {
				dispatch({ type: "agent_status", online: frame.online, cwd: frame.cwd });
				if (frame.online) {
					void syncHistory();
					void call({ type: "piwebui_list_sessions", limit: 60 });
					void call({ type: "piwebui_get_config" });
				}
				return;
			}
			if (frame.type === "error") {
				dispatch({ type: "error", message: frame.message });
				return;
			}
			if (frame.type !== "relay") return;

			const record = frame.record;

			if (record && typeof record === "object" && (record as { type?: string }).type === "response") {
				const response = record as PiResponse;
				if (response.id && pendingRef.current.has(response.id)) {
					const pending = pendingRef.current.get(response.id)!;
					window.clearTimeout(pending.timer);
					pendingRef.current.delete(response.id);
					pending.resolve(response);
					// Still fold the data into the store so subscribers see model lists etc.
					dispatch({ type: "response", response });
					return;
				}
				dispatch({ type: "response", response });
				return;
			}

			if (record && typeof record === "object" && (record as { type?: string }).type === "extension_ui_request") {
				const request = record as ExtensionUIRequest;
				const method = (request as { method?: string }).method;
				if (method === "notify") {
					const rawTone = (request as { notifyType?: "info" | "warning" | "error" }).notifyType;
					const tone: Toast["tone"] = rawTone === "warning" ? "warn" : rawTone === "error" ? "error" : "info";
					pushToast((request as { message?: string }).message ?? "", tone);
					return;
				}
				if (method === "setTitle" || method === "setStatus" || method === "setWidget" || method === "set_editor_text") {
					return;
				}
				dispatch({ type: "extension", request });
				return;
			}

			if (record && typeof record === "object" && (record as { type?: string }).type === "piwebui_stderr") {
				dispatch({ type: "stderr", line: (record as { line: string }).line });
				return;
			}

			if (record && typeof record === "object" && (record as { type?: string }).type === "piwebui_process") {
				const processState = (record as { state: "starting" | "ready" | "exited" }).state;
				dispatch({ type: "process", state: processState });
				return;
			}

			dispatch({ type: "event", event: record as SessionEvent });

			// Session files only land on disk after a turn completes, so refresh the
			// catalog once the agent settles rather than on every message.
			const eventType = (record as { type?: string }).type;
			if (eventType === "agent_settled" || eventType === "session_info_changed") {
				window.setTimeout(() => {
					void call({ type: "piwebui_list_sessions", limit: 60 });
				}, 700);
			}
		};

		connect();

		return () => {
			disposedRef.current = true;
			if (reconnectTimerRef.current !== null) {
				window.clearTimeout(reconnectTimerRef.current);
				reconnectTimerRef.current = null;
			}
			if (heartbeatRef.current !== null) {
				window.clearInterval(heartbeatRef.current);
				heartbeatRef.current = null;
			}
			wsRef.current?.close();
			wsRef.current = null;
		};
	}, [enabled, call, syncHistory]);

	/* -------------------- actions -------------------- */

	const prompt = useCallback(
		(text: string, attachments: Attachment[], behavior?: "steer" | "followUp") => {
			const trimmed = text.trim();
			if (!trimmed && attachments.length === 0) return;

			dispatch({
				type: "optimistic-user",
				message: {
					key: nextKey("u"),
					role: "user",
					blocks: trimmed ? [{ kind: "text", text: trimmed }] : [],
					attachments: attachments.length ? attachments : undefined,
					timestamp: Date.now(),
					pending: true,
				},
			});

			const command: PiCommand = {
				type: "prompt",
				message: trimmed,
				images: attachments.length
					? attachments.map((a) => ({ type: "image" as const, data: a.data, mimeType: a.mimeType }))
					: undefined,
				streamingBehavior: behavior,
			};

			void call(command).then((response) => {
				if (!response.success) {
					dispatch({ type: "error", message: response.error ?? "发送失败" });
				}
			});
		},
		[call],
	);

	const abort = useCallback(() => {
		void call({ type: "abort" });
	}, [call]);

	const clearQueue = useCallback(async () => {
		const response = await call({ type: "clear_queue" });
		const data = response.data as { steering?: string[]; followUp?: string[] } | undefined;
		const restored = [...(data?.steering ?? []), ...(data?.followUp ?? [])].join("\n");
		if (restored) pushToast("已撤回排队消息，内容已复制到输入框", "info");
		return restored;
	}, [call, pushToast]);

	const newSession = useCallback(async () => {
		await call({ type: "new_session" });
		dispatch({ type: "reset-timeline" });
		await syncHistory();
		refreshSessions();
	}, [call, syncHistory, refreshSessions]);

	const switchSession = useCallback(
		async (sessionPath: string) => {
			const response = await call({ type: "piwebui_open_session", sessionPath });
			if (!response.success) {
				pushToast(response.error ?? "切换会话失败", "error");
				return;
			}
			dispatch({ type: "reset-timeline" });
			// Opening a session from another project restarts pi in that directory;
			// syncHistory lands in the queue and flushes once pi reports ready.
			await syncHistory();
			void call({ type: "piwebui_get_config" });
			refreshSessions();
		},
		[call, syncHistory, pushToast, refreshSessions],
	);

	const setModel = useCallback(
		(provider: string, modelId: string) => {
			void call({ type: "set_model", provider, modelId });
		},
		[call],
	);

	const setThinkingLevel = useCallback(
		(level: string) => {
			void call({ type: "set_thinking_level", level });
		},
		[call],
	);

	const cycleThinkingLevel = useCallback(() => {
		void call({ type: "cycle_thinking_level" });
	}, [call]);

	const renameSession = useCallback(
		(name: string) => {
			void call({ type: "set_session_name", name });
			refreshSessions();
		},
		[call, refreshSessions],
	);

	const compact = useCallback(() => {
		void call({ type: "compact" });
	}, [call]);

	const restartPi = useCallback(() => {
		void call({ type: "piwebui_restart_pi" });
		pushToast("正在重启本地 pi 进程…", "info");
	}, [call, pushToast]);

	const respondExtension = useCallback(
		(id: string, response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
			sendRaw({ type: "extension_ui_response", id, ...response });
			dispatch({ type: "extension-done", id });
		},
		[sendRaw],
	);

	return useMemo(
		() => ({
			store,
			prompt,
			abort,
			clearQueue,
			newSession,
			switchSession,
			refreshSessions,
			refreshState,
			setModel,
			setThinkingLevel,
			cycleThinkingLevel,
			renameSession,
			compact,
			restartPi,
			respondExtension,
			call,
			dismissToast: (id: string) => dispatch({ type: "dismiss-toast", id }),
			clearError: () => dispatch({ type: "clear-error" }),
			toast: pushToast,
		}),
		[
			store,
			prompt,
			abort,
			clearQueue,
			newSession,
			switchSession,
			refreshSessions,
			refreshState,
			setModel,
			setThinkingLevel,
			cycleThinkingLevel,
			renameSession,
			compact,
			restartPi,
			respondExtension,
			call,
			pushToast,
		],
	);
}
