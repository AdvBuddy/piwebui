import type { AuthStatusResponse, TranscribeResponse } from "@piwebui/shared";

async function parseError(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as { error?: string };
		if (body?.error) return body.error;
	} catch {
		/* not json */
	}
	if (response.status === 401) return "未登录或登录已过期";
	if (response.status === 413) return "文件过大";
	return `请求失败（${response.status}）`;
}

export async function fetchStatus(): Promise<AuthStatusResponse> {
	const response = await fetch("/api/status", { credentials: "same-origin" });
	if (!response.ok) throw new Error("无法连接服务器");
	return (await response.json()) as AuthStatusResponse;
}

export async function login(token: string): Promise<void> {
	const response = await fetch("/api/login", {
		method: "POST",
		headers: { "content-type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify({ token }),
	});
	if (!response.ok) throw new Error(await parseError(response));
}

export async function logout(): Promise<void> {
	await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
}

export async function transcribe(blob: Blob, filename: string, language?: string): Promise<TranscribeResponse> {
	const form = new FormData();
	form.append("audio", blob, filename);
	if (language) form.append("language", language);

	const response = await fetch("/api/transcribe", {
		method: "POST",
		body: form,
		credentials: "same-origin",
	});
	if (!response.ok) throw new Error(await parseError(response));
	return (await response.json()) as TranscribeResponse;
}
