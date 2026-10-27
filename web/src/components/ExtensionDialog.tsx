import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import type { ExtensionUIRequest } from "@piwebui/shared";

interface ExtensionDialogProps {
	request: ExtensionUIRequest;
	onRespond: (response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
}

export function ExtensionDialog({ request, onRespond }: ExtensionDialogProps) {
	const isText = request.method === "input" || request.method === "editor";
	const prefill =
		request.method === "editor" ? (request.prefill ?? "") : request.method === "input" ? "" : "";
	const [value, setValue] = useState(prefill);

	useEffect(() => {
		setValue(prefill);
	}, [request.id, prefill]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onRespond({ cancelled: true });
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onRespond]);

	const title = (request as { title?: string; message?: string }).title ?? "";
	const message = (request as { message?: string }).message;

	return (
		<div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 p-3 backdrop-blur-sm sm:items-center">
			<div className="anim-in w-full max-w-md overflow-hidden rounded-2xl border border-line bg-bg-elev shadow-[var(--shadow)]">
				<div className="flex items-start gap-2.5 border-b border-line px-4 py-3">
					<span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
						<Icon name="alert" size={14} />
					</span>
					<div className="min-w-0 flex-1">
						<div className="text-[14px] font-medium leading-snug text-fg">{title || "agent 需要你的确认"}</div>
						{message && (
							<div className="mt-1 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words text-fg-muted">
								{message}
							</div>
						)}
					</div>
				</div>

				<div className="px-4 py-3">
					{request.method === "select" && (
						<div className="flex flex-col gap-1.5">
							{request.options.map((option) => (
								<button
									key={option}
									type="button"
									onClick={() => onRespond({ value: option })}
									className="tap rounded-lg border border-line bg-panel px-3 py-2 text-left text-[13px] text-fg-muted hover:border-accent/60 hover:bg-accent-soft hover:text-fg"
								>
									{option}
								</button>
							))}
						</div>
					)}

					{isText && (
						<textarea
							autoFocus
							value={value}
							onChange={(event) => setValue(event.target.value)}
							rows={request.method === "editor" ? 6 : 3}
							placeholder={
								request.method === "input"
									? ((request as { placeholder?: string }).placeholder ?? "输入内容…")
									: ""
							}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.shiftKey && request.method === "input") {
									event.preventDefault();
									onRespond({ value });
								}
							}}
							className="w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 font-mono text-[13px] leading-relaxed outline-none focus:border-accent"
						/>
					)}

					{request.method === "confirm" && (
						<div className="text-[12.5px] text-fg-dim">确认后将立即执行。</div>
					)}
				</div>

				<div className="flex items-center justify-end gap-2 border-t border-line bg-panel-2/40 px-4 py-2.5">
					<button
						type="button"
						onClick={() => onRespond({ cancelled: true })}
						className="tap rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-fg-muted hover:text-fg"
					>
						取消
					</button>
					{request.method === "confirm" && (
						<button
							type="button"
							onClick={() => onRespond({ confirmed: true })}
							className="tap rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-accent-fg hover:brightness-110"
						>
							确认
						</button>
					)}
					{isText && (
						<button
							type="button"
							onClick={() => onRespond({ value })}
							className="tap rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-accent-fg hover:brightness-110"
						>
							提交
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
