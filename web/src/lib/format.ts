export function formatClock(timestamp: number): string {
	const date = new Date(timestamp);
	const hh = String(date.getHours()).padStart(2, "0");
	const mm = String(date.getMinutes()).padStart(2, "0");
	return `${hh}:${mm}`;
}

export function formatRelative(timestamp: number): string {
	if (!timestamp) return "";
	const diff = Date.now() - timestamp;
	if (diff < 45_000) return "刚刚";
	if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
	if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
	if (diff < 7 * 86_400_000) return `${Math.round(diff / 86_400_000)} 天前`;
	const date = new Date(timestamp);
	return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatDuration(ms: number | undefined): string {
	if (!ms || ms < 0) return "";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1000);
	return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}

export function formatTokens(count: number | undefined): string {
	if (!count) return "0";
	if (count < 1000) return String(count);
	if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
	return `${(count / 1_000_000).toFixed(2)}M`;
}

export function formatCost(total: number | undefined): string {
	if (!total || total <= 0) return "$0";
	if (total < 0.01) return `$${total.toFixed(4)}`;
	if (total < 1) return `$${total.toFixed(3)}`;
	return `$${total.toFixed(2)}`;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatVoiceTime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
	const ss = String(seconds % 60).padStart(2, "0");
	return `${mm}:${ss}`;
}

/** Baseline-relative path display: keeps long absolute paths readable. */
export function shortenPath(fullPath: string, cwd?: string | null, max = 48): string {
	let display = fullPath;
	if (cwd && fullPath.startsWith(cwd)) {
		const rest = fullPath.slice(cwd.length).replace(/^[/\\]/, "");
		display = rest || fullPath;
	}
	if (display.length <= max) return display;
	const parts = display.split(/[/\\]/);
	if (parts.length <= 2) return `…${display.slice(-max)}`;
	return `…${parts.slice(-2).join("/")}`;
}
