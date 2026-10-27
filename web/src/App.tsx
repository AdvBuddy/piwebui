import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { ExtensionDialog } from "./components/ExtensionDialog";
import { Icon } from "./components/Icon";
import { Login } from "./components/Login";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { fetchStatus, logout } from "./lib/api";
import { useAgent } from "./lib/agent";
import type { UiMessage } from "./lib/model";

type Phase = "checking" | "login" | "ready";
type Theme = "dark" | "light";

const THEME_KEY = "piwebui:theme";

function readTheme(): Theme {
	const stored = localStorage.getItem(THEME_KEY);
	if (stored === "light" || stored === "dark") return stored;
	return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export default function App() {
	const [phase, setPhase] = useState<Phase>("checking");
	const [theme, setTheme] = useState<Theme>(readTheme);
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [seed, setSeed] = useState<{ text: string; id: number } | null>(null);

	const agent = useAgent(phase === "ready");

	useLayoutEffect(() => {
		const root = document.documentElement;
		root.classList.toggle("theme-light", theme === "light");
		root.classList.toggle("dark", theme === "dark");
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute("content", theme === "light" ? "#ffffff" : "#0a0c10");
		localStorage.setItem(THEME_KEY, theme);
	}, [theme]);

	useEffect(() => {
		let cancelled = false;
		fetchStatus()
			.then((status) => {
				if (cancelled) return;
				setPhase(status.authenticated ? "ready" : "login");
			})
			.catch(() => {
				if (!cancelled) setPhase("login");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const toggleTheme = useCallback(() => {
		setTheme((prev) => (prev === "dark" ? "light" : "dark"));
	}, []);

	const handleLogout = useCallback(async () => {
		await logout().catch(() => undefined);
		setPhase("login");
	}, []);

	if (phase === "checking") {
		return (
			<div className="flex h-[100dvh] items-center justify-center">
				<div className="flex flex-col items-center gap-3 text-fg-dim">
					<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg">
						<Icon name="terminal" size={19} strokeWidth={2} />
					</div>
					<span className="text-[12px]">正在连接…</span>
				</div>
			</div>
		);
	}

	if (phase === "login") {
		return (
			<div className="h-[100dvh] overflow-y-auto">
				<Login onSuccess={() => setPhase("ready")} />
			</div>
		);
	}

	const { store } = agent;
	const title = store.state.sessionName || deriveTitle(store.messages) || "新会话";
	const extension = store.extensionQueue[0];

	return (
		<div className="flex h-[100dvh] overflow-hidden bg-bg">
			<Sidebar
				sessions={store.sessions}
				currentPath={store.state.sessionFile}
				loading={store.sessionsLoading}
				open={sidebarOpen}
				onClose={() => setSidebarOpen(false)}
				onNew={() => void agent.newSession()}
				onSelect={(path) => void agent.switchSession(path)}
				onRefresh={agent.refreshSessions}
				cwd={store.cwd}
				hostName={store.host ?? undefined}
			/>

			<main className="flex min-w-0 flex-1 flex-col">
				<TopBar
					title={title}
					busy={store.busy}
					connected={store.connected}
					agentOnline={store.agentOnline}
					cwd={store.cwd}
					model={store.state.model}
					models={store.availableModels}
					thinkingLevel={store.state.thinkingLevel}
					thinkingLevels={store.thinkingLevels}
					theme={theme}
					onMenu={() => setSidebarOpen(true)}
					onSetModel={agent.setModel}
					onSetThinking={agent.setThinkingLevel}
					onCompact={agent.compact}
					onRestart={agent.restartPi}
					onRename={agent.renameSession}
					onToggleTheme={toggleTheme}
					onLogout={() => void handleLogout()}
				/>

				<ChatView
					messages={store.messages}
					busy={store.busy}
					connected={store.connected}
					agentOnline={store.agentOnline}
					cwd={store.cwd}
					sessionName={store.state.sessionName}
					onSuggest={(text) => setSeed({ text, id: Date.now() })}
				/>

				<Composer
					busy={store.busy}
					agentOnline={store.agentOnline}
					queue={store.queue}
					seed={seed}
					supportsVision={store.state.model?.input?.includes("image") ?? true}
					onSend={(text, attachments, behavior) => agent.prompt(text, attachments, behavior)}
					onAbort={agent.abort}
					onToast={agent.toast}
				/>
			</main>

			{extension && (
				<ExtensionDialog
					key={extension.id}
					request={extension}
					onRespond={(response) => agent.respondExtension(extension.id, response)}
				/>
			)}

			<Toasts toasts={store.toasts} onDismiss={agent.dismissToast} />

			{store.lastError && <ErrorBanner message={store.lastError} onDismiss={agent.clearError} />}
		</div>
	);
}

/* ------------------------------------------------------------------ */

function deriveTitle(messages: UiMessage[]): string {
	for (const message of messages) {
		if (message.role !== "user") continue;
		const text = message.blocks
			.filter((b) => b.kind === "text")
			.map((b) => (b.kind === "text" ? b.text : ""))
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();
		if (text) return text.length > 34 ? `${text.slice(0, 34)}…` : text;
	}
	return "";
}

function Toasts({
	toasts,
	onDismiss,
}: {
	toasts: { id: string; message: string; tone: "info" | "warn" | "error" }[];
	onDismiss: (id: string) => void;
}) {
	if (toasts.length === 0) return null;
	return (
		<div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col gap-1.5">
			{toasts.map((toast) => (
				<button
					key={toast.id}
					type="button"
					onClick={() => onDismiss(toast.id)}
					className={[
						"anim-in pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2 text-left text-[12.5px] shadow-[var(--shadow)] backdrop-blur",
						toast.tone === "error"
							? "border-danger/40 bg-danger/10 text-danger"
							: toast.tone === "warn"
								? "border-warn/40 bg-warn/10 text-warn"
								: "border-line bg-bg-elev/95 text-fg-muted",
					].join(" ")}
				>
					<Icon
						name={toast.tone === "error" ? "alert" : toast.tone === "warn" ? "alert" : "check"}
						size={13}
						className="mt-0.5 shrink-0"
					/>
					<span className="flex-1">{toast.message}</span>
				</button>
			))}
		</div>
	);
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
	const [visible, setVisible] = useState(true);
	useEffect(() => {
		setVisible(true);
		const timer = window.setTimeout(() => setVisible(false), 6000);
		return () => window.clearTimeout(timer);
	}, [message]);

	if (!visible) return null;

	return (
		<div className="pointer-events-none fixed left-1/2 top-14 z-[65] w-[min(92vw,30rem)] -translate-x-1/2">
			<div className="pointer-events-auto flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/[0.09] px-3 py-2 text-[12.5px] text-danger shadow-[var(--shadow)] backdrop-blur">
				<Icon name="alert" size={13} className="mt-0.5 shrink-0" />
				<span className="flex-1 whitespace-pre-wrap">{message}</span>
				<button type="button" onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100">
					<Icon name="close" size={12} />
				</button>
			</div>
		</div>
	);
}
