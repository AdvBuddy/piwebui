import { useMemo } from "react";
import { Icon } from "./Icon";
import { formatRelative } from "../lib/format";
import type { SessionSummary } from "@piwebui/shared";

interface SidebarProps {
	sessions: SessionSummary[];
	currentPath?: string;
	loading: boolean;
	open: boolean;
	onClose: () => void;
	onNew: () => void;
	onSelect: (path: string) => void;
	onRefresh: () => void;
	cwd?: string | null;
	hostName?: string;
}

export function Sidebar({
	sessions,
	currentPath,
	loading,
	open,
	onClose,
	onNew,
	onSelect,
	onRefresh,
	cwd,
	hostName,
}: SidebarProps) {
	const groups = useMemo(() => groupSessions(sessions, cwd), [sessions, cwd]);

	return (
		<>
			{open && (
				<div
					className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden"
					onClick={onClose}
					aria-hidden
				/>
			)}
			<aside
				className={[
					"fixed inset-y-0 left-0 z-40 flex w-[276px] flex-col border-r border-line bg-bg-elev transition-transform duration-200 md:static md:z-auto md:translate-x-0",
					open ? "translate-x-0" : "-translate-x-full",
				].join(" ")}
			>
				<div className="flex h-12 items-center gap-2 px-3">
					<div className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight">
						<span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-accent-fg">
							<Icon name="terminal" size={13} strokeWidth={2.2} />
						</span>
						<span>piwebui</span>
					</div>
					<div className="flex-1" />
					<button
						type="button"
						onClick={onRefresh}
						className="tap flex h-7 w-7 items-center justify-center rounded-md text-fg-dim hover:bg-panel hover:text-fg"
						aria-label="刷新会话列表"
						title="刷新"
					>
						<Icon name="refresh" size={14} className={loading ? "spin" : ""} />
					</button>
					<button
						type="button"
						onClick={onClose}
						className="tap flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-panel md:hidden"
						aria-label="关闭侧栏"
					>
						<Icon name="close" size={15} />
					</button>
				</div>

				<div className="px-3 pb-2">
					<button
						type="button"
						onClick={onNew}
						className="tap flex w-full items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-2 text-[13px] text-fg-muted hover:border-line-strong hover:text-fg"
					>
						<Icon name="plus" size={14} />
						新建会话
					</button>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
					{groups.length === 0 && (
						<div className="px-2 py-8 text-center text-[12px] text-fg-dim">
							{loading ? "加载中…" : "暂无历史会话"}
						</div>
					)}
					{groups.map((group) => (
						<div key={group.label} className="mb-3">
							<div className="px-2 py-1 text-[10.5px] font-medium uppercase tracking-wider text-fg-dim">
								{group.label}
							</div>
							{group.items.map((session) => {
								const active = currentPath === session.path;
								return (
									<button
										key={session.path}
										type="button"
										onClick={() => {
											onSelect(session.path);
											onClose();
										}}
										className={[
											"tap group mb-0.5 flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left",
											active ? "bg-accent-soft text-fg" : "text-fg-muted hover:bg-panel",
										].join(" ")}
									>
										<span className="flex w-full items-center gap-1.5">
											<span className="truncate text-[12.5px] font-medium">
												{session.name || deriveTitle(session)}
											</span>
										</span>
										<span className="flex w-full items-center gap-1.5 text-[10.5px] text-fg-dim">
											<span className="truncate">{session.preview}</span>
										</span>
										<span className="flex items-center gap-2 text-[10px] text-fg-dim">
											<span>{formatRelative(session.updatedAt)}</span>
											<span>·</span>
											<span>{session.messageCount} 条</span>
											{active && <span className="text-accent">· 当前</span>}
											{!group.isCurrent && <span className="text-warn">· 其他目录</span>}
										</span>
									</button>
								);
							})}
						</div>
					))}
				</div>

				<div className="border-t border-line px-3 py-2.5 text-[10.5px] leading-relaxed text-fg-dim">
					<div className="flex items-center gap-1.5">
						<Icon name="folder" size={11} />
						<span className="truncate font-mono" title={cwd ?? ""}>
							{cwd ? compactPath(cwd) : "未知目录"}
						</span>
					</div>
					{hostName && (
						<div className="mt-0.5 flex items-center gap-1.5">
							<Icon name="cpu" size={11} />
							<span className="truncate font-mono">{hostName}</span>
						</div>
					)}
				</div>
			</aside>
		</>
	);
}

function groupSessions(
	sessions: SessionSummary[],
	currentCwd?: string | null,
): { label: string; items: SessionSummary[]; isCurrent: boolean }[] {
	const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
	const target = currentCwd ? normalize(currentCwd) : null;

	const current: SessionSummary[] = [];
	const others = new Map<string, SessionSummary[]>();

	for (const session of sessions) {
		if (target && normalize(session.cwd) === target) {
			current.push(session);
			continue;
		}
		const key = session.cwd || "(未知目录)";
		const bucket = others.get(key);
		if (bucket) bucket.push(session);
		else others.set(key, [session]);
	}

	const groups: { label: string; items: SessionSummary[]; isCurrent: boolean }[] = [];
	if (current.length > 0) {
		groups.push({ label: "当前项目", items: current, isCurrent: true });
	}

	const otherGroups = Array.from(others.entries()).sort(
		(a, b) => (b[1][0]?.updatedAt ?? 0) - (a[1][0]?.updatedAt ?? 0),
	);
	for (const [cwd, items] of otherGroups) {
		groups.push({ label: shortDir(cwd), items, isCurrent: false });
	}

	return groups;
}

function shortDir(cwd: string): string {
	const parts = cwd.split(/[/\\]/).filter(Boolean);
	if (parts.length === 0) return cwd;
	return parts.slice(-2).join("/");
}

function deriveTitle(session: SessionSummary): string {
	if (session.name) return session.name;
	const preview = session.preview?.trim();
	if (preview && preview !== "(empty session)") return preview.slice(0, 32);
	const id = session.id?.slice(0, 8) ?? "session";
	return `会话 ${id}`;
}

function compactPath(fullPath: string): string {
	const parts = fullPath.split(/[/\\]/).filter(Boolean);
	if (parts.length <= 3) return fullPath;
	return `…/${parts.slice(-2).join("/")}`;
}
