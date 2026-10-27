import { memo, useState } from "react";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCard } from "./ToolCard";
import { attachmentUrl } from "../lib/image";
import { formatClock, formatCost, formatTokens } from "../lib/format";
import type { UiMessage } from "../lib/model";

interface MessageItemProps {
	message: UiMessage;
}

export const MessageItem = memo(function MessageItem({ message }: MessageItemProps) {
	if (message.role === "user") return <UserMessage message={message} />;
	if (message.role === "bash") return <BashMessage message={message} />;
	if (message.role === "summary" || message.role === "custom") return <SystemNote message={message} />;
	return <AssistantMessage message={message} />;
});

/* ------------------------------------------------------------------ */

function UserMessage({ message }: { message: UiMessage }) {
	const text = message.blocks
		.filter((b) => b.kind === "text")
		.map((b) => (b.kind === "text" ? b.text : ""))
		.join("\n");

	return (
		<div className="anim-in flex justify-end px-4 py-2 sm:px-6">
			<div className="max-w-[min(100%,44rem)]">
				{message.attachments && message.attachments.length > 0 && (
					<div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
						{message.attachments.map((attachment) => (
							<a
								key={attachment.id}
								href={attachmentUrl(attachment)}
								target="_blank"
								rel="noreferrer noopener"
								className="block overflow-hidden rounded-lg border border-line"
							>
								<img
									src={attachmentUrl(attachment)}
									alt="附件"
									className="max-h-44 w-auto max-w-[18rem] object-contain transition-transform hover:scale-[1.02]"
									loading="lazy"
								/>
							</a>
						))}
					</div>
				)}
				{text && (
					<div className="rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-[15px] leading-[1.65] whitespace-pre-wrap break-words text-fg">
						{text}
					</div>
				)}
				<div className="mt-1 flex items-center justify-end gap-1.5 pr-1 text-[10.5px] text-fg-dim">
					{message.pending && <span>发送中…</span>}
					<span>{formatClock(message.timestamp)}</span>
				</div>
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */

function AssistantMessage({ message }: { message: UiMessage }) {
	const [copied, setCopied] = useState(false);

	const textContent = message.blocks
		.filter((b) => b.kind === "text")
		.map((b) => (b.kind === "text" ? b.text : ""))
		.join("\n\n");

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(textContent);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		} catch {
			/* ignore */
		}
	};

	return (
		<div className="anim-in group px-4 py-2 sm:px-6">
			<div className="mx-auto w-full max-w-3xl">
				{message.blocks.map((block, index) => {
					switch (block.kind) {
						case "text":
							return (
								<div key={index} className="relative">
									<Markdown content={block.text} streaming={block.streaming} />
									{block.streaming && block.text.length === 0 && <TypingDots />}
								</div>
							);
						case "thinking":
							return <ThinkingBlock key={index} text={block.text} streaming={block.streaming} />;
						case "toolCall":
							return <ToolCard key={block.id || index} block={block} />;
						case "notice":
							return (
								<div
									key={index}
									className={[
										"my-2 rounded-lg border px-3 py-2 text-[12.5px]",
										block.tone === "error"
											? "border-danger/40 bg-danger/[0.06] text-danger"
											: block.tone === "warn"
												? "border-warn/40 bg-warn/[0.06] text-warn"
												: "border-line bg-panel-2/60 text-fg-muted",
									].join(" ")}
								>
									{block.text}
								</div>
							);
						default:
							return null;
					}
				})}

				{message.error && (
					<div className="mt-2 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/[0.06] px-3 py-2 text-[12.5px] text-danger">
						<Icon name="alert" size={14} className="mt-0.5 shrink-0" />
						<span className="whitespace-pre-wrap">{message.error}</span>
					</div>
				)}

				{message.streaming && message.blocks.length === 0 && (
					<div className="py-1">
						<TypingDots />
					</div>
				)}

				<div className="mt-1 flex h-6 items-center gap-2 text-[10.5px] text-fg-dim opacity-0 transition-opacity group-hover:opacity-100">
					{textContent && (
						<button
							type="button"
							onClick={copy}
							className="tap flex items-center gap-1 rounded px-1 py-0.5 hover:bg-panel-2 hover:text-fg-muted"
						>
							<Icon name={copied ? "check" : "copy"} size={11} />
							{copied ? "已复制" : "复制"}
						</button>
					)}
					{message.usage && (
						<span className="tabular-nums">
							{formatTokens(message.usage.input)}↑ {formatTokens(message.usage.output)}↓
							{message.usage.cost?.total > 0 && ` · ${formatCost(message.usage.cost.total)}`}
						</span>
					)}
					{message.model && <span className="truncate">{shortModel(message.model)}</span>}
					<span>{formatClock(message.timestamp)}</span>
				</div>
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */

function BashMessage({ message }: { message: UiMessage }) {
	const command = message.blocks[0]?.kind === "text" ? message.blocks[0].text : "";
	const output = message.blocks[1]?.kind === "text" ? message.blocks[1].text : "";

	return (
		<div className="px-4 py-2 sm:px-6">
			<div className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-line bg-panel/60">
				<div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11px] text-fg-dim">
					<Icon name="terminal" size={13} />
					<span>命令</span>
				</div>
				<pre className="overflow-x-auto px-3 py-2 font-mono text-[12.5px] text-fg">$ {command}</pre>
				{output && (
					<pre className="max-h-64 overflow-auto border-t border-line/60 px-3 py-2 font-mono text-[12px] whitespace-pre-wrap text-fg-muted">
						{output}
					</pre>
				)}
			</div>
		</div>
	);
}

function SystemNote({ message }: { message: UiMessage }) {
	const text = message.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("\n");
	if (!text) return null;
	return (
		<div className="px-6 py-2">
			<div className="mx-auto max-w-3xl text-center text-[11.5px] text-fg-dim">{text}</div>
		</div>
	);
}

function TypingDots() {
	return (
		<div className="flex items-center gap-1 py-1">
			<span className="dot" style={{ animationDelay: "0ms" }} />
			<span className="dot" style={{ animationDelay: "160ms" }} />
			<span className="dot" style={{ animationDelay: "320ms" }} />
		</div>
	);
}

function shortModel(model: string): string {
	const parts = model.split(/[/:]/);
	return parts[parts.length - 1] || model;
}
