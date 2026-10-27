import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { VoiceRecorder, extensionForMime } from "../lib/audio";
import { fileToAttachment, imagesFromDataTransfer } from "../lib/image";
import { transcribe } from "../lib/api";
import { formatVoiceTime } from "../lib/format";
import type { Attachment } from "../lib/model";
import { attachmentUrl } from "../lib/image";

const MAX_ATTACHMENTS = 5;
const MAX_TEXTAREA_HEIGHT = 200;

interface ComposerProps {
	busy: boolean;
	agentOnline: boolean;
	/** Injected text from suggestion chips or a restored queue. */
	seed?: { text: string; id: number } | null;
	/** False when the active model's `input` list has no "image". */
	supportsVision: boolean;
	onSend: (text: string, attachments: Attachment[], behavior?: "steer" | "followUp") => void;
	onAbort: () => void;
	onToast: (message: string, tone?: "info" | "warn" | "error") => void;
	queue: { steering: string[]; followUp: string[] };
}

export function Composer({
	busy,
	agentOnline,
	seed,
	supportsVision,
	onSend,
	onAbort,
	onToast,
	queue,
}: ComposerProps) {
	const [text, setText] = useState("");
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [dragging, setDragging] = useState(false);

	const [recording, setRecording] = useState(false);
	const [level, setLevel] = useState(0);
	const [elapsed, setElapsed] = useState(0);
	const [transcribing, setTranscribing] = useState(false);

	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const recorderRef = useRef<VoiceRecorder | null>(null);
	const elapsedTimerRef = useRef<number | null>(null);
	const coarsePointer = useRef(false);

	useEffect(() => {
		coarsePointer.current = window.matchMedia?.("(pointer: coarse)").matches ?? false;
	}, []);

	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
	}, [text]);

	useEffect(() => {
		if (!seed) return;
		setText((prev) => (prev.trim() ? `${prev}${prev.endsWith(" ") ? "" : " "}${seed.text}` : seed.text));
		requestAnimationFrame(() => textareaRef.current?.focus());
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [seed?.id]);

	useEffect(() => {
		return () => {
			recorderRef.current?.cancel();
			if (elapsedTimerRef.current !== null) window.clearInterval(elapsedTimerRef.current);
		};
	}, []);

	/* --------------------------- attachments --------------------------- */

	const addFiles = useCallback(
		async (files: File[]) => {
			const images = files.filter((file) => file.type.startsWith("image/"));
			if (images.length === 0) return;
			const remaining = MAX_ATTACHMENTS - attachments.length;
			if (remaining <= 0) {
				onToast(`最多添加 ${MAX_ATTACHMENTS} 张图片`, "warn");
				return;
			}
			const next: Attachment[] = [];
			for (const file of images.slice(0, remaining)) {
				try {
					next.push(await fileToAttachment(file));
				} catch (error) {
					onToast(error instanceof Error ? error.message : "图片处理失败", "error");
				}
			}
			if (next.length) setAttachments((prev) => [...prev, ...next]);
			if (images.length > remaining) onToast(`部分图片被忽略（上限 ${MAX_ATTACHMENTS} 张）`, "warn");
			if (next.length > 0 && !supportsVision) {
				onToast("当前模型不支持图片输入，请先在右上角切换到支持视觉的模型", "warn");
			}
		},
		[attachments.length, onToast, supportsVision],
	);

	const removeAttachment = (id: string) => {
		setAttachments((prev) => prev.filter((a) => a.id !== id));
	};

	/* ----------------------------- sending ----------------------------- */

	const submit = useCallback(
		(behavior?: "steer" | "followUp") => {
			if (transcribing) return;
			if (!text.trim() && attachments.length === 0) return;
			if (!agentOnline) {
				onToast("本地 agent 未连接，请先启动 agent-host", "error");
				return;
			}
			onSend(text, attachments, behavior);
			setText("");
			setAttachments([]);
			requestAnimationFrame(() => {
				const el = textareaRef.current;
				if (el) {
					el.style.height = "auto";
					el.focus();
				}
			});
		},
		[agentOnline, attachments, onSend, onToast, text, transcribing],
	);

	const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== "Enter") return;
		if (event.nativeEvent.isComposing) return; // IME composition (Chinese input)
		const wantsNewline = event.shiftKey || coarsePointer.current;
		if (wantsNewline) return;
		event.preventDefault();
		submit(busy ? "steer" : undefined);
	};

	/* ----------------------------- recording --------------------------- */

	const startRecording = async () => {
		if (!VoiceRecorder.supported) {
			onToast("当前浏览器不支持录音", "error");
			return;
		}
		const recorder = new VoiceRecorder({
			onLevel: setLevel,
			onError: (message) => onToast(message, "error"),
		});
		recorderRef.current = recorder;
		try {
			await recorder.start();
			setRecording(true);
			setElapsed(0);
			elapsedTimerRef.current = window.setInterval(() => {
				setElapsed(recorder.elapsedMs);
			}, 200);
		} catch (error) {
			onToast(error instanceof Error ? error.message : "无法开始录音", "error");
			recorderRef.current = null;
		}
	};

	const stopRecording = async (cancel = false) => {
		const recorder = recorderRef.current;
		recorderRef.current = null;
		if (elapsedTimerRef.current !== null) {
			window.clearInterval(elapsedTimerRef.current);
			elapsedTimerRef.current = null;
		}
		setRecording(false);
		setLevel(0);

		if (!recorder) return;
		if (cancel) {
			recorder.cancel();
			return;
		}

		try {
			const blob = await recorder.stop();
			if (blob.size < 1200) {
				onToast("录音太短，请再说一次", "warn");
				return;
			}
			setTranscribing(true);
			const result = await transcribe(blob, `speech.${extensionForMime(blob.type)}`, "");
			const transcript = result.text.trim();
			if (!transcript) {
				onToast("没有识别到语音内容", "warn");
				return;
			}
			setText((prev) => (prev ? `${prev}${prev.endsWith(" ") ? "" : " "}${transcript}` : transcript));
			requestAnimationFrame(() => textareaRef.current?.focus());
		} catch (error) {
			onToast(error instanceof Error ? error.message : "转写失败", "error");
		} finally {
			setTranscribing(false);
		}
	};

	/* ------------------------------ render ----------------------------- */

	const canSend = (text.trim().length > 0 || attachments.length > 0) && agentOnline && !transcribing;
	const queuedCount = queue.steering.length + queue.followUp.length;

	return (
		<div className="pt-safe pb-safe glass border-t border-line">
			<div className="mx-auto w-full max-w-3xl px-3 pb-3 pt-2 sm:px-4">
				{queuedCount > 0 && (
					<div className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-panel-2/70 px-2.5 py-1.5 text-[11.5px] text-fg-muted">
						<Icon name="clock" size={12} />
						<span>
							已排队 {queuedCount} 条消息
							{queue.steering.length > 0 && `（插话 ${queue.steering.length}）`}
							{queue.followUp.length > 0 && `（追加 ${queue.followUp.length}）`}
						</span>
					</div>
				)}

				{attachments.length > 0 && (
					<div className="mb-2 flex flex-wrap gap-2">
						{attachments.map((attachment) => (
							<div key={attachment.id} className="group relative">
								<img
									src={attachmentUrl(attachment)}
									alt={attachment.name ?? "附件"}
									className="h-16 w-16 rounded-lg border border-line object-cover"
								/>
								<button
									type="button"
									onClick={() => removeAttachment(attachment.id)}
									className="tap absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-panel text-fg-muted hover:text-danger"
									aria-label="移除图片"
								>
									<Icon name="close" size={11} />
								</button>
							</div>
						))}
					</div>
				)}

				{attachments.length > 0 && !supportsVision && (
					<div className="mb-2 flex items-center gap-1.5 rounded-lg border border-warn/40 bg-warn/[0.08] px-2.5 py-1.5 text-[11.5px] text-warn">
						<Icon name="alert" size={12} />
						<span>当前模型不支持图片，发送会失败 —— 请切换到带视觉能力的模型</span>
					</div>
				)}

				{recording ? (
					<VoicePanel
						level={level}
						elapsed={elapsed}
						onCancel={() => void stopRecording(true)}
						onDone={() => void stopRecording(false)}
					/>
				) : (
					<div
						className={[
							"relative rounded-2xl border bg-panel transition-colors",
							dragging ? "border-accent bg-accent-soft/40" : "border-line focus-within:border-line-strong",
						].join(" ")}
						onDragOver={(event) => {
							event.preventDefault();
							setDragging(true);
						}}
						onDragLeave={() => setDragging(false)}
						onDrop={(event) => {
							event.preventDefault();
							setDragging(false);
							void addFiles(imagesFromDataTransfer(event.dataTransfer));
						}}
					>
						<textarea
							ref={textareaRef}
							value={text}
							onChange={(event) => setText(event.target.value)}
							onKeyDown={onKeyDown}
							onPaste={(event) => {
								const files = imagesFromDataTransfer(event.clipboardData);
								if (files.length > 0) {
									event.preventDefault();
									void addFiles(files);
								}
							}}
							rows={1}
							placeholder={
								transcribing ? "正在转写语音…" : agentOnline ? "给 agent 发消息…" : "等待本地 agent 连接…"
							}
							className="block max-h-[200px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] leading-[1.55] outline-none placeholder:text-fg-dim"
						/>

						<div className="flex items-center gap-1 px-2 pb-2 pt-1">
							<button
								type="button"
								onClick={() => fileInputRef.current?.click()}
								className="tap flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-panel-2 hover:text-fg"
								aria-label="添加图片"
								title="添加图片"
							>
								<Icon name="image" size={17} />
							</button>
							<button
								type="button"
								onClick={() => void (recording ? stopRecording(false) : startRecording())}
								className={[
									"tap flex h-8 w-8 items-center justify-center rounded-lg hover:bg-panel-2",
									transcribing ? "text-accent" : "text-fg-muted hover:text-fg",
								].join(" ")}
								aria-label="语音输入"
								title="语音输入（转文字）"
								disabled={transcribing}
							>
								{transcribing ? (
									<Icon name="refresh" size={16} className="spin" />
								) : (
									<Icon name="mic" size={17} />
								)}
							</button>

							<div className="flex-1" />

							<span className="hidden pr-2 text-[10.5px] text-fg-dim sm:block">
								{busy ? "Enter 插话 · Shift+Enter 换行" : "Enter 发送 · Shift+Enter 换行"}
							</span>

							{busy && (
								<button
									type="button"
									onClick={onAbort}
									className="tap flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12.5px] text-fg-muted hover:border-danger/50 hover:text-danger"
									title="中断当前运行"
								>
									<Icon name="stop" size={13} />
									<span>停止</span>
								</button>
							)}

							<button
								type="button"
								onClick={() => submit(busy ? "steer" : undefined)}
								disabled={!canSend}
								className={[
									"tap ml-1 flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium",
									canSend
										? "bg-accent text-accent-fg hover:brightness-110"
										: "cursor-not-allowed bg-panel-3 text-fg-dim",
								].join(" ")}
								title={busy ? "插话（当前回合工具执行完后送达）" : "发送"}
							>
								<Icon name={busy ? "sparkles" : "send"} size={15} />
								<span className="hidden sm:inline">{busy ? "插话" : "发送"}</span>
							</button>
						</div>
					</div>
				)}

				<input
					ref={fileInputRef}
					type="file"
					accept="image/*"
					multiple
					className="hidden"
					onChange={(event) => {
						const files = Array.from(event.target.files ?? []);
						void addFiles(files);
						event.target.value = "";
					}}
				/>
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */

function VoicePanel({
	level,
	elapsed,
	onCancel,
	onDone,
}: {
	level: number;
	elapsed: number;
	onCancel: () => void;
	onDone: () => void;
}) {
	const bars = 28;
	return (
		<div className="flex items-center gap-3 rounded-2xl border border-accent/50 bg-panel px-3 py-2.5">
			<button
				type="button"
				onClick={onCancel}
				className="tap flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-panel-2 hover:text-danger"
				aria-label="取消录音"
			>
				<Icon name="trash" size={16} />
			</button>

			<div className="flex flex-1 items-center gap-3 overflow-hidden">
				<span className="flex h-8 items-center gap-[3px]">
					{Array.from({ length: bars }).map((_, index) => {
						const phase = Math.sin((index / bars) * Math.PI);
						const height = 4 + level * phase * 26 + Math.random() * 2;
						return (
							<span
								key={index}
								className="w-[3px] rounded-full bg-accent/80 transition-[height] duration-100"
								style={{ height: `${Math.max(3, height)}px` }}
							/>
						);
					})}
				</span>
				<span className="shrink-0 font-mono text-[12px] tabular-nums text-fg-muted">
					{formatVoiceTime(elapsed)}
				</span>
			</div>

			<button
				type="button"
				onClick={onDone}
				className="tap flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-accent px-3.5 text-[13px] font-medium text-accent-fg"
			>
				<Icon name="check" size={15} />
				完成
			</button>
		</div>
	);
}
