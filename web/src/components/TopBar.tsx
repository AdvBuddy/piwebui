import { useMemo, useState } from "react";
import { Icon } from "./Icon";
import { MenuDivider, MenuItem, MenuLabel, Popover } from "./Popover";

export interface ModelInfo {
	provider: string;
	id: string;
	name?: string;
	contextWindow?: number;
	[k: string]: unknown;
}

interface TopBarProps {
	title: string;
	busy: boolean;
	connected: boolean;
	agentOnline: boolean;
	cwd?: string | null;
	model?: { provider: string; id: string; name?: string };
	models: ModelInfo[];
	thinkingLevel?: string;
	thinkingLevels: string[];
	theme: "dark" | "light";
	onMenu: () => void;
	onSetModel: (provider: string, modelId: string) => void;
	onSetThinking: (level: string) => void;
	onCompact: () => void;
	onRestart: () => void;
	onRename: (name: string) => void;
	onToggleTheme: () => void;
	onLogout: () => void;
}

const THINKING_LABEL: Record<string, string> = {
	off: "关闭",
	minimal: "最少",
	low: "低",
	medium: "中",
	high: "高",
	xhigh: "很高",
	max: "最大",
};

export function TopBar(props: TopBarProps) {
	const {
		title,
		busy,
		connected,
		agentOnline,
		cwd,
		model,
		models,
		thinkingLevel,
		thinkingLevels,
		theme,
	} = props;

	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(title);
	const [query, setQuery] = useState("");

	const filteredModels = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return models;
		return models.filter(
			(m) =>
				m.id.toLowerCase().includes(q) ||
				(m.name ?? "").toLowerCase().includes(q) ||
				m.provider.toLowerCase().includes(q),
		);
	}, [models, query]);

	const statusColor = !connected ? "bg-fg-dim" : agentOnline ? "bg-ok" : "bg-warn";
	const statusText = !connected ? "连接中…" : agentOnline ? (busy ? "运行中" : "就绪") : "agent 离线";

	return (
		<header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-bg-elev/80 px-2 backdrop-blur sm:px-3">
			<button
				type="button"
				onClick={props.onMenu}
				className="tap flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-panel-2 hover:text-fg md:hidden"
				aria-label="打开会话列表"
			>
				<Icon name="menu" size={17} />
			</button>

			{editing ? (
				<input
					autoFocus
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={() => {
						setEditing(false);
						if (draft.trim() && draft !== title) props.onRename(draft.trim());
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.currentTarget.blur();
						} else if (event.key === "Escape") {
							setDraft(title);
							setEditing(false);
						}
					}}
					className="min-w-0 max-w-[min(46%,26rem)] flex-1 rounded-md border border-line bg-panel px-2 py-1 text-[13px] outline-none focus:border-accent"
				/>
			) : (
				<button
					type="button"
					onClick={() => {
						setDraft(title);
						setEditing(true);
					}}
					className="tap min-w-0 max-w-[min(46%,26rem)] truncate rounded-md px-1.5 py-1 text-left text-[13px] font-medium text-fg hover:bg-panel-2"
					title={cwd ?? title}
				>
					{title}
				</button>
			)}

			<div className="flex-1" />

			<div className="flex items-center gap-1">
				{/* status */}
				<div
					className="hidden items-center gap-1.5 rounded-full border border-line px-2 py-1 text-[10.5px] text-fg-muted sm:flex"
					title={statusText}
				>
					<span className={`h-1.5 w-1.5 rounded-full ${statusColor} ${busy ? "animate-pulse" : ""}`} />
					<span>{statusText}</span>
				</div>

				{/* model picker */}
				<Popover
					width={320}
					trigger={({ toggle }) => (
						<button
							type="button"
							onClick={toggle}
							className="tap flex max-w-[9rem] items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11.5px] text-fg-muted hover:border-line-strong hover:text-fg sm:max-w-[14rem]"
							title="切换模型"
						>
							<Icon name="cpu" size={13} />
							<span className="truncate">{model ? shortModel(model) : "选择模型"}</span>
							<Icon name="chevron-down" size={11} className="shrink-0 opacity-60" />
						</button>
					)}
				>
					{({ close }) => (
						<div>
							<div className="border-b border-line p-2">
								<input
									autoFocus
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									placeholder="搜索模型…"
									className="w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[12.5px] outline-none focus:border-accent"
								/>
							</div>
							<div className="max-h-[320px] overflow-y-auto py-1">
								{filteredModels.length === 0 && (
									<div className="px-3 py-6 text-center text-[12px] text-fg-dim">没有匹配的模型</div>
								)}
								{filteredModels.map((item) => {
									const active = model?.provider === item.provider && model?.id === item.id;
									return (
										<MenuItem
											key={`${item.provider}/${item.id}`}
											label={item.name || item.id}
											hint={item.provider}
											active={active}
											onClick={() => {
												props.onSetModel(item.provider, item.id);
												close();
											}}
										/>
									);
								})}
							</div>
						</div>
					)}
				</Popover>

				{/* thinking level */}
				{thinkingLevels.length > 1 && (
					<Popover
						width={180}
						trigger={({ toggle }) => (
							<button
								type="button"
								onClick={toggle}
								className="tap hidden items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11.5px] text-fg-muted hover:border-line-strong hover:text-fg sm:flex"
								title="思考等级"
							>
								<Icon name="brain" size={13} />
								<span>{THINKING_LABEL[thinkingLevel ?? ""] ?? thinkingLevel ?? "—"}</span>
							</button>
						)}
					>
						{({ close }) => (
							<div className="py-1">
								<MenuLabel>思考等级</MenuLabel>
								{thinkingLevels.map((level) => (
									<MenuItem
										key={level}
										label={THINKING_LABEL[level] ?? level}
										hint={level}
										active={thinkingLevel === level}
										onClick={() => {
											props.onSetThinking(level);
											close();
										}}
									/>
								))}
							</div>
						)}
					</Popover>
				)}

				<button
					type="button"
					onClick={props.onToggleTheme}
					className="tap flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-panel-2 hover:text-fg"
					aria-label="切换主题"
					title="切换主题"
				>
					<Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
				</button>

				<Popover
					width={220}
					trigger={({ toggle }) => (
						<button
							type="button"
							onClick={toggle}
							className="tap flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted hover:bg-panel-2 hover:text-fg"
							aria-label="更多"
						>
							<Icon name="settings" size={16} />
						</button>
					)}
				>
					{({ close }) => (
						<div className="py-1">
							<MenuItem
								icon="sparkles"
								label="压缩上下文"
								onClick={() => {
									props.onCompact();
									close();
								}}
							/>
							<MenuItem
								icon="refresh"
								label="重启本地 pi"
								onClick={() => {
									props.onRestart();
									close();
								}}
							/>
							<MenuDivider />
							<MenuItem
								icon="moon"
								label={theme === "dark" ? "切换到浅色" : "切换到深色"}
								onClick={() => {
									props.onToggleTheme();
									close();
								}}
							/>
							<MenuItem
								icon="logout"
								label="退出登录"
								danger
								onClick={() => {
									close();
									props.onLogout();
								}}
							/>
						</div>
					)}
				</Popover>
			</div>
		</header>
	);
}

function shortModel(model: { id: string; name?: string }): string {
	if (model.name) return model.name;
	const parts = model.id.split("/");
	return parts[parts.length - 1] || model.id;
}
