import { useState } from "react";
import { Icon } from "./Icon";
import { login } from "../lib/api";

export function Login({ onSuccess }: { onSuccess: () => void }) {
	const [token, setToken] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!token.trim() || busy) return;
		setBusy(true);
		setError(null);
		try {
			await login(token.trim());
			onSuccess();
		} catch (err) {
			setError(err instanceof Error ? err.message : "登录失败");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="flex min-h-full items-center justify-center px-4 py-10">
			<div className="w-full max-w-sm">
				<div className="mb-7 flex flex-col items-center gap-3">
					<div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-[var(--shadow)]">
						<Icon name="terminal" size={24} strokeWidth={2} />
					</div>
					<div className="text-center">
						<h1 className="text-[19px] font-semibold tracking-tight">piwebui</h1>
						<p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
							远程访问你本机的 pi coding agent
						</p>
					</div>
				</div>

				<form onSubmit={submit} className="rounded-2xl border border-line bg-bg-elev p-4 shadow-[var(--shadow)]">
					<label className="mb-1.5 block text-[12px] font-medium text-fg-muted" htmlFor="token">
						访问令牌
					</label>
					<input
						id="token"
						type="password"
						autoComplete="current-password"
						autoFocus
						value={token}
						onChange={(event) => setToken(event.target.value)}
						placeholder="粘贴服务器 .env 里的 ACCESS_TOKEN"
						className="w-full rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-[13px] outline-none transition-colors focus:border-accent"
					/>

					{error && (
						<div className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-danger/35 bg-danger/[0.07] px-2.5 py-2 text-[12px] text-danger">
							<Icon name="alert" size={13} className="mt-0.5 shrink-0" />
							<span>{error}</span>
						</div>
					)}

					<button
						type="submit"
						disabled={busy || !token.trim()}
						className={[
							"tap mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-[13.5px] font-medium",
							busy || !token.trim()
								? "cursor-not-allowed bg-panel-3 text-fg-dim"
								: "bg-accent text-accent-fg hover:brightness-110",
						].join(" ")}
					>
						{busy ? <Icon name="refresh" size={15} className="spin" /> : <Icon name="plug" size={15} />}
						{busy ? "验证中…" : "进入"}
					</button>
				</form>

				<p className="mt-4 text-center text-[11px] leading-relaxed text-fg-dim">
					登录状态会保存在此浏览器 30 天
				</p>
			</div>
		</div>
	);
}
