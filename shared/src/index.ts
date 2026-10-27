/**
 * Shared wire protocol for piwebui.
 *
 * Three hops, two protocols:
 *
 *   browser  <--WS /ws-->   server   <--WS /agent-->   agent-host   <--stdio JSONL-->   pi
 *
 * The server is a dumb relay: everything the agent-host reads from pi's stdout is
 * forwarded verbatim to every attached browser, and everything a browser sends is
 * forwarded verbatim to the agent-host. The records themselves are pi's own RPC
 * protocol (see `npx pi --help`, docs/rpc.md). On top of that we add a thin control
 * envelope for transport-level concerns (auth, presence, session catalog).
 */

/* ------------------------------------------------------------------ */
/* pi content blocks & messages                                        */
/* ------------------------------------------------------------------ */

export interface TextContent {
	type: "text";
	text: string;
	textSignature?: string;
}

export interface ImageContent {
	type: "image";
	/** base64, no data: prefix */
	data: string;
	mimeType: string;
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
	thinkingSignature?: string;
	redacted?: boolean;
}

export interface ToolCall {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	thoughtSignature?: string;
	namespace?: string;
}

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning?: number;
	totalTokens: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

export type AssistantStopReason =
	| "pending"
	| "stop"
	| "length"
	| "toolUse"
	| "error"
	| "aborted"
	| "deferred";

export interface SystemMessage {
	role: "system";
	content: string | TextContent[];
	sections?: Record<string, string | null>;
	timestamp: number;
}

export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	timestamp: number;
}

export interface AssistantMessage {
	role: "assistant";
	content: (TextContent | ThinkingContent | ToolCall)[];
	api?: string;
	provider?: string;
	model?: string;
	responseModel?: string;
	responseId?: string;
	thinkingLevel?: string;
	usage?: Usage;
	stopReason: AssistantStopReason;
	errorMessage?: string;
	rawStopReason?: string;
	endTurn?: boolean;
	timestamp: number;
}

export interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[];
	details?: unknown;
	usage?: Usage;
	isError: boolean;
	timestamp: number;
}

export interface BashExecutionMessage {
	role: "bashExecution";
	command: string;
	output: string;
	exitCode?: number;
	cancelled: boolean;
	truncated: boolean;
	fullOutputPath?: string;
	excludeFromContext?: boolean;
	timestamp: number;
}

export interface CustomMessage {
	role: "custom";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	display: boolean;
	details?: unknown;
	timestamp: number;
}

export interface BranchSummaryMessage {
	role: "branchSummary";
	summary: string;
	fromId: string | null;
	timestamp: number;
}

export interface CompactionSummaryMessage {
	role: "compactionSummary";
	summary: string;
	tokensBefore: number;
	timestamp: number;
}

export type AgentMessage =
	| SystemMessage
	| UserMessage
	| AssistantMessage
	| ToolResultMessage
	| BashExecutionMessage
	| CustomMessage
	| BranchSummaryMessage
	| CompactionSummaryMessage;

/* ------------------------------------------------------------------ */
/* pi streaming sub-events (message_update.assistantMessageEvent)        */
/* ------------------------------------------------------------------ */

export type AssistantMessageEvent =
	| { type: "start" }
	| { type: "text_start"; contentIndex: number }
	| { type: "text_delta"; contentIndex: number; delta: string }
	| { type: "text_end"; contentIndex: number; content: string }
	| { type: "thinking_start"; contentIndex: number }
	| { type: "thinking_delta"; contentIndex: number; delta: string }
	| { type: "thinking_end"; contentIndex: number; content: string }
	| { type: "toolcall_start"; contentIndex: number; id: string; toolName: string }
	| { type: "toolcall_delta"; contentIndex: number; delta: string }
	| { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall }
	| { type: "done"; reason?: string }
	| { type: "error"; reason?: string; error?: string };

/* ------------------------------------------------------------------ */
/* pi session events (stdout)                                          */
/* ------------------------------------------------------------------ */

export interface ToolExecutionResult {
	content?: (TextContent | ImageContent)[];
	details?: unknown;
	isError?: boolean;
}

export type SessionEvent =
	| { type: "agent_start" }
	| { type: "agent_end"; messages: AgentMessage[]; willRetry?: boolean }
	| { type: "agent_settled"; aborted?: boolean }
	| { type: "turn_start" }
	| { type: "turn_end"; message: AssistantMessage; toolResults?: ToolResultMessage[] }
	| { type: "message_start"; message: AgentMessage }
	| { type: "message_update"; usage?: Usage; assistantMessageEvent: AssistantMessageEvent }
	| { type: "message_end"; message: AgentMessage }
	| {
			type: "tool_execution_start";
			toolCallId: string;
			toolName: string;
			args?: Record<string, unknown>;
	  }
	| {
			type: "tool_execution_update";
			toolCallId: string;
			toolName: string;
			args?: Record<string, unknown>;
			partialResult?: ToolExecutionResult;
	  }
	| {
			type: "tool_execution_end";
			toolCallId: string;
			toolName: string;
			result?: ToolExecutionResult;
			isError?: boolean;
			durationMs?: number;
	  }
	| { type: "queue_update"; steering: string[]; followUp: string[] }
	| { type: "entry_appended"; entry: unknown }
	| { type: "session_info_changed"; name?: string }
	| { type: "thinking_level_changed"; level: string }
	| { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
	| { type: "compaction_end"; summary?: string; tokensBefore?: number; aborted?: boolean }
	| { type: "summarization_retry_scheduled"; [k: string]: unknown }
	| { type: "summarization_retry_attempt_start"; [k: string]: unknown }
	| { type: "summarization_retry_finished"; [k: string]: unknown }
	| { type: "bash_execution_update"; id?: string; [k: string]: unknown }
	| { type: "auto_retry_start"; [k: string]: unknown }
	| { type: "auto_retry_end"; [k: string]: unknown };

/* ------------------------------------------------------------------ */
/* pi commands (stdin) — the subset the web UI drives                   */
/* ------------------------------------------------------------------ */

export type StreamingBehavior = "steer" | "followUp";

export interface PromptCommand {
	id?: string;
	type: "prompt";
	message: string;
	images?: ImageContent[];
	streamingBehavior?: StreamingBehavior;
}

export type PiCommand =
	| PromptCommand
	| { id?: string; type: "steer"; message: string; images?: ImageContent[] }
	| { id?: string; type: "follow_up"; message: string; images?: ImageContent[] }
	| { id?: string; type: "abort" }
	| { id?: string; type: "clear_queue" }
	| { id?: string; type: "new_session"; parentSession?: string }
	| { id?: string; type: "get_state" }
	| { id?: string; type: "get_messages" }
	| { id?: string; type: "set_model"; provider: string; modelId: string }
	| { id?: string; type: "cycle_model" }
	| { id?: string; type: "get_available_models" }
	| { id?: string; type: "set_thinking_level"; level: string }
	| { id?: string; type: "cycle_thinking_level" }
	| { id?: string; type: "get_available_thinking_levels" }
	| { id?: string; type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
	| { id?: string; type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }
	| { id?: string; type: "compact"; customInstructions?: string }
	| { id?: string; type: "set_auto_compaction"; enabled: boolean }
	| { id?: string; type: "set_auto_retry"; enabled: boolean }
	| { id?: string; type: "abort_retry" }
	| { id?: string; type: "bash"; command: string }
	| { id?: string; type: "abort_bash" }
	| { id?: string; type: "get_session_stats" }
	| { id?: string; type: "export_html"; outputPath?: string }
	| { id?: string; type: "switch_session"; sessionPath: string }
	| { id?: string; type: "fork"; entryId?: string }
	| { id?: string; type: "clone" }
	| { id?: string; type: "get_fork_messages" }
	| { id?: string; type: "get_entries" }
	| { id?: string; type: "get_tree" }
	| { id?: string; type: "get_last_assistant_text" }
	| { id?: string; type: "set_session_name"; name: string }
	| { id?: string; type: "get_commands" };

export interface PiResponse {
	type: "response";
	id?: string;
	command: string;
	success: boolean;
	data?: unknown;
	error?: string;
}

/* ------------------------------------------------------------------ */
/* extension UI sub-protocol                                           */
/* ------------------------------------------------------------------ */

export type ExtensionUIRequest =
	| { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
	| {
			type: "extension_ui_request";
			id: string;
			method: "confirm";
			title: string;
			message?: string;
			timeout?: number;
	  }
	| { type: "extension_ui_request"; id: string; method: "input"; title: string; placeholder?: string; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "editor"; title: string; prefill?: string; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "notify"; message: string; notifyType?: "info" | "warning" | "error" }
	| { type: "extension_ui_request"; id: string; method: "setStatus"; statusKey: string; statusText?: string }
	| {
			type: "extension_ui_request";
			id: string;
			method: "setWidget";
			widgetKey: string;
			widgetLines?: string[];
			widgetPlacement?: "aboveEditor" | "belowEditor";
	  }
	| { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
	| { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string };

export interface ExtensionUIResponse {
	type: "extension_ui_response";
	id: string;
	value?: string;
	confirmed?: boolean;
	cancelled?: boolean;
}

/* ------------------------------------------------------------------ */
/* Local-only commands served by agent-host (never reach pi)           */
/* ------------------------------------------------------------------ */

export interface SessionSummary {
	path: string;
	id: string;
	name?: string;
	cwd: string;
	updatedAt: number;
	messageCount: number;
	preview: string;
	sizeBytes: number;
}

export type LocalCommand =
	| { id?: string; type: "piwebui_list_sessions"; limit?: number }
	| { id?: string; type: "piwebui_open_session"; sessionPath: string }
	| { id?: string; type: "piwebui_ping" }
	| { id?: string; type: "piwebui_restart_pi" }
	| { id?: string; type: "piwebui_get_config" };

/* ------------------------------------------------------------------ */
/* Transport envelopes                                                 */
/* ------------------------------------------------------------------ */

/** Anything flowing agent-host -> server -> browser. */
export type AgentToClient =
	| SessionEvent
	| PiResponse
	| ExtensionUIRequest
	| { id?: string; type: "response"; command: "piwebui_list_sessions"; success: true; data: { sessions: SessionSummary[] } }
	| { id?: string; type: "response"; command: "piwebui_ping"; success: true; data: Record<string, unknown> }
	| { id?: string; type: "response"; command: string; success: boolean; data?: unknown; error?: string }
	| { type: "piwebui_stderr"; line: string }
	| { type: "piwebui_process"; state: "starting" | "ready" | "exited"; code?: number | null; signal?: string | null };

/** Anything flowing browser -> server -> agent-host. */
export type ClientToAgent = PiCommand | LocalCommand | ExtensionUIResponse;

/** Server-originated frames to a browser. */
export type ServerFrame =
	| { type: "hello"; agentOnline: boolean; serverTime: number; cwd: string | null; version: string }
	| { type: "agent_status"; online: boolean; cwd?: string | null }
	| { type: "relay"; record: AgentToClient }
	| { type: "error"; message: string };

/** Browser-originated frames to the server. */
export type BrowserFrame =
	| { type: "relay"; record: ClientToAgent }
	| { type: "ping"; t: number };

/** agent-host -> server handshake + traffic. */
export type AgentFrame =
	| { type: "hello"; secret: string; host: string; cwd: string; pid: number; version: string }
	| { type: "relay"; record: AgentToClient }
	| { type: "ping"; t: number };

/** server -> agent-host. */
export type ServerToAgentFrame =
	| { type: "hello_ok"; serverTime: number; clients: number }
	| { type: "relay"; record: ClientToAgent }
	| { type: "pong"; t: number }
	| { type: "error"; message: string };

/* ------------------------------------------------------------------ */
/* HTTP API                                                            */
/* ------------------------------------------------------------------ */

export interface TranscribeResponse {
	text: string;
	language?: string;
	durationMs?: number;
	model?: string;
}

export interface AuthStatusResponse {
	authenticated: boolean;
	agentOnline: boolean;
	version: string;
}

export const PROTOCOL_VERSION = 1;
