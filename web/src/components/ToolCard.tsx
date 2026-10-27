import { memo, useMemo, useState } from "react";
import { Icon, type IconName } from "./Icon";
import { extractToolDiff, presentTool, type ToolBlock } from "../lib/model";
import { formatDuration } from "../lib/format";

const FLAVOR_ICON: Record<string, IconName> = {
	bash: "terminal",
	edit: "pencil",
	write: "pencil",
	read: "file",
	grep: "search",
	glob: "folder",
	web: "globe",
	generic: "cpu",
};

export const ToolCard = memo(function ToolCard({ block }: { block: ToolBlock }) {
	const [expanded, setExpanded] = useState(false);
	const [showFull, setShowFull] = useState(false);

	const presentation = useMemo(() => presentTool(block.name, block.args), [block.name, block.args]);
	const diff = useMemo(() => extractToolDiff(block.name, block.args), [block.name, block.args]);

	const status = block.status;
	const isError = status === "error";
	const isBusy = status === "running" || status === "streaming" || status === "pending";
	const icon = FLAVOR_ICON[presentation.flavor] ?? "cpu";

	// Errors are the one case where hiding output actively hurts; open them.
	const open = expanded || isError;

	return (
		<div
			className={[
				"my-3 overflow-hidden rounded-xl border text-[13px]",
				isError ? "border-danger/40 bg-danger/[0.04]" : "border-line bg-panel/60",
			].join(" ")}
		>
			<button
				type="button"
				onClick={() => setExpanded((v) => !v)}
				className="tap flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-panel-2/60"
			>
				<span
					className={[
						"flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
						isError ? "bg-danger/15 text-danger" : "bg-panel-3 text-fg-muted",
					].join(" ")}
				>
					{isBusy ? (
						<span className="flex items-end gap-[2px]" aria-hidden>
							{[0, 1, 2].map((i) => (
								<span
									key={i}
									className="wave-bar block h-2.5 w-[2px] rounded-full bg-current"
									style={{ animationDelay: `${i * 120}ms` }}
								/>
							))}
						</span>
					) : (
						<Icon name={isError ? "alert" : icon} size={14} />
					)}
				</span>

				<span className="min-w-0 flex-1">
					<span className="flex items-baseline gap-2">
						<span className="font-medium text-fg">{presentation.title}</span>
						{presentation.subtitle && (
							<span className="truncate font-mono text-[11.5px] text-fg-dim">{presentation.subtitle}</span>
						)}
					</span>
				</span>

				<span className="flex shrink-0 items-center gap-2 text-[11px] text-fg-dim tabular-nums">
					{block.durationMs !== undefined && <span>{formatDuration(block.durationMs)}</span>}
					{isBusy && <span className="text-accent">运行中</span>}
					<Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
				</span>
			</button>

			{open && (
				<div className="border-t border-line/70 bg-bg-elev/40">
					{diff ? (
						<div className="max-h-64 overflow-auto py-1 font-mono text-[12px] leading-[1.6]">
							{diff.slice(0, showFull ? diff.length : 40).map((line, index) => (
								<span
									key={index}
									className={[
										"diff-line",
										line.type === "+" ? "diff-add" : line.type === "-" ? "diff-del" : "",
									].join(" ")}
								>
									<span className="mr-2 select-none opacity-50">{line.type}</span>
									{line.text || " "}
								</span>
							))}
							{!showFull && diff.length > 40 && (
								<button
									type="button"
									onClick={() => setShowFull(true)}
									className="tap mx-3 my-1 text-[11px] text-accent hover:underline"
								>
									展开全部 {diff.length} 行
								</button>
							)}
						</div>
					) : (
						<ArgsView block={block} />
					)}

					{(block.output || block.outputImages?.length) && (
						<div className="border-t border-line/60">
							<div className="flex items-center gap-1.5 px-3 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wider text-fg-dim">
								<Icon name="terminal" size={10} />
								输出
							</div>
							{block.outputImages?.map((src, index) => (
								<img
									key={index}
									src={src}
									alt="工具输出图片"
									className="max-h-72 w-auto p-2"
									loading="lazy"
								/>
							))}
							{block.output && (
								<pre className="max-h-72 overflow-auto whitespace-pre px-3 pb-2 pt-1 font-mono text-[11.5px] leading-[1.55] text-fg-muted">
									{trimOutput(block.output, showFull)}
								</pre>
							)}
							{block.output && block.output.split("\n").length > 200 && !showFull && (
								<button
									type="button"
									onClick={() => setShowFull(true)}
									className="tap px-3 pb-2 text-[11px] text-accent hover:underline"
								>
									显示完整输出（{block.output.split("\n").length} 行）
								</button>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
});

function ArgsView({ block }: { block: ToolBlock }) {
	const entries = Object.entries(block.args ?? {});
	const raw = block.argsRaw;

	if (entries.length === 0) {
		return (
			<pre className="max-h-32 overflow-auto px-3 py-2 font-mono text-[11.5px] text-fg-dim">
				{raw || "（无参数）"}
			</pre>
		);
	}

	return (
		<div className="max-h-56 overflow-auto px-3 py-2">
			{entries.map(([key, value]) => (
				<div key={key} className="mb-1.5 last:mb-0">
					<span className="font-mono text-[11px] text-fg-dim">{key}</span>
					<pre className="mt-0.5 overflow-x-auto whitespace-pre rounded bg-panel-3/60 px-2 py-1 font-mono text-[11.5px] text-fg-muted">
						{renderedValue(value)}
					</pre>
				</div>
			))}
		</div>
	);
}

function renderedValue(value: unknown): string {
	if (typeof value === "string") return value.length > 4000 ? `${value.slice(0, 4000)}\n…` : value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function trimOutput(output: string, full: boolean): string {
	if (full) return output;
	const lines = output.split("\n");
	if (lines.length <= 200) return output;
	return `… 省略 ${lines.length - 200} 行 …\n${lines.slice(-200).join("\n")}`;
}
