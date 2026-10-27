import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

export function Popover({
	trigger,
	children,
	align = "right",
	width = 260,
	open: controlledOpen,
	onOpenChange,
}: {
	trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
	children: (props: { close: () => void }) => ReactNode;
	align?: "left" | "right";
	width?: number;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}) {
	const [internalOpen, setInternalOpen] = useState(false);
	const open = controlledOpen ?? internalOpen;
	const setOpen = (value: boolean) => {
		setInternalOpen(value);
		onOpenChange?.(value);
	};
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: MouseEvent | TouchEvent) => {
			if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onPointerDown);
		document.addEventListener("touchstart", onPointerDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onPointerDown);
			document.removeEventListener("touchstart", onPointerDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	return (
		<div className="relative" ref={ref}>
			{trigger({ open, toggle: () => setOpen(!open) })}
			{open && (
				<div
					className={[
						"absolute top-[calc(100%+6px)] z-50 overflow-hidden rounded-xl border border-line bg-bg-elev shadow-[var(--shadow)] anim-in",
						align === "right" ? "right-0" : "left-0",
					].join(" ")}
					style={{ width }}
				>
					{children({ close: () => setOpen(false) })}
				</div>
			)}
		</div>
	);
}

export function MenuItem({
	icon,
	label,
	hint,
	active,
	danger,
	onClick,
}: {
	icon?: React.ComponentProps<typeof Icon>["name"];
	label: string;
	hint?: string;
	active?: boolean;
	danger?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={[
				"tap flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]",
				danger ? "text-danger hover:bg-danger/10" : "text-fg-muted hover:bg-panel-2 hover:text-fg",
				active ? "bg-accent-soft text-fg" : "",
			].join(" ")}
		>
			{icon && <Icon name={icon} size={14} className="shrink-0 opacity-80" />}
			<span className="flex-1 truncate">{label}</span>
			{hint && <span className="shrink-0 text-[10.5px] text-fg-dim">{hint}</span>}
			{active && <Icon name="check" size={13} />}
		</button>
	);
}

export function MenuLabel({ children }: { children: ReactNode }) {
	return (
		<div className="px-3 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-wider text-fg-dim">
			{children}
		</div>
	);
}

export function MenuDivider() {
	return <div className="my-1 h-px bg-line" />;
}
