import { memo, useState } from "react";
import { Icon } from "./Icon";

interface ThinkingBlockProps {
	text: string;
	streaming?: boolean;
}

export const ThinkingBlock = memo(function ThinkingBlock({ text, streaming }: ThinkingBlockProps) {
	const [open, setOpen] = useState(false);
	const lines = text.split("\n").filter(Boolean).length;

	return (
		<div className="my-2">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="tap flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] text-fg-dim hover:bg-panel-2 hover:text-fg-muted"
			>
				<Icon name="brain" size={13} className={streaming ? "opacity-70" : ""} />
				<span>{streaming ? "正在思考…" : `思考过程 · ${lines} 行`}</span>
				<Icon name={open ? "chevron-down" : "chevron-right"} size={12} />
			</button>
			{open && (
				<div className="mt-1.5 border-l-2 border-line-strong pl-3 text-[13px] leading-[1.75] whitespace-pre-wrap text-fg-dim">
					{text}
				</div>
			)}
		</div>
	);
});
