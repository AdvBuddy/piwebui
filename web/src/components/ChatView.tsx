import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { MessageItem } from "./MessageItem";
import type { UiMessage } from "../lib/model";

interface ChatViewProps {
	messages: UiMessage[];
	busy: boolean;
	connected: boolean;
	agentOnline: boolean;
	cwd?: string | null;
	sessionName?: string;
	onSuggest: (text: string) => void;
}

const SUGGESTIONS = [
	"看一下当前目录的结构，简单介绍这个项目",
	"git status，然后告诉我有哪些未提交的改动",
	"找出这个仓库里最需要重构的一个文件并说明原因",
];

export function ChatView({ messages, busy, connected, agentOnline, cwd, sessionName, onSuggest }: ChatViewProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const stickRef = useRef(true);
	const frameRef = useRef<number | null>(null);
	const [showJump, setShowJump] = useState(false);

	const scrollToBottom = useCallback((smooth = false) => {
		const el = scrollRef.current;
		if (!el) return;
		el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
	}, []);

	// Follow the stream only while the user is already parked at the bottom.
	useLayoutEffect(() => {
		if (!stickRef.current) return;
		if (frameRef.current !== null) return;
		frameRef.current = requestAnimationFrame(() => {
			frameRef.current = null;
			scrollToBottom();
		});
	}, [messages, scrollToBottom]);

	useEffect(() => {
		return () => {
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
		};
	}, []);

	const onScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
		const atBottom = distance < 96;
		stickRef.current = atBottom;
		setShowJump(!atBottom);
	};

	if (messages.length === 0) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-10">
				<div className="w-full max-w-lg">
					<div className="mb-5 flex flex-col items-center gap-2 text-center">
						<div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-panel text-fg-muted">
							<Icon name="sparkles" size={20} />
						</div>
						<h2 className="text-[16px] font-semibold tracking-tight">
							{sessionName || "开始一段新会话"}
						</h2>
						<p className="text-[12.5px] leading-relaxed text-fg-muted">
							{agentOnline
								? `已连接本地 pi${cwd ? ` · ${cwd}` : ""}`
								: connected
									? "服务器已连接，等待本地 agent-host 上线…"
									: "正在连接服务器…"}
						</p>
					</div>

					<div className="flex flex-col gap-1.5">
						{SUGGESTIONS.map((suggestion) => (
							<button
								key={suggestion}
								type="button"
								disabled={!agentOnline}
								onClick={() => onSuggest(suggestion)}
								className="tap flex items-center gap-2 rounded-xl border border-line bg-panel/60 px-3 py-2.5 text-left text-[12.5px] text-fg-muted hover:border-line-strong hover:bg-panel hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
							>
								<Icon name="chevron-right" size={13} className="shrink-0 opacity-50" />
								<span>{suggestion}</span>
							</button>
						))}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="relative min-h-0 flex-1">
			<div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain py-3">
				{messages.map((message) => (
					<MessageItem key={message.key} message={message} />
				))}
				<div className="h-2" />
			</div>

			{showJump && (
				<button
					type="button"
					onClick={() => {
						stickRef.current = true;
						setShowJump(false);
						scrollToBottom(true);
					}}
					className="tap absolute bottom-3 left-1/2 z-10 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-bg-elev/95 px-3 text-[11.5px] text-fg-muted shadow-[var(--shadow)] backdrop-blur hover:text-fg"
				>
					<Icon name="arrow-down" size={13} />
					{busy ? "回到最新" : "回到底部"}
				</button>
			)}
		</div>
	);
}
