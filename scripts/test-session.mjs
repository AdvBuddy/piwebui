import WebSocket from "ws";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const TOKEN = process.env.TOKEN ?? "";

const loginRes = await fetch(`${BASE}/api/login`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ token: TOKEN }),
});
const cookie = (loginRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

const ws = new WebSocket(BASE.replace("http", "ws") + "/ws", { headers: { cookie } });
const pending = new Map();

function call(record) {
	const id = `c${Math.random().toString(36).slice(2, 8)}`;
	return new Promise((resolve) => {
		pending.set(id, resolve);
		ws.send(JSON.stringify({ type: "relay", record: { ...record, id } }));
		setTimeout(() => resolve({ success: false, error: "timeout" }), 30_000);
	});
}

ws.on("message", (data) => {
	const frame = JSON.parse(data.toString());
	if (frame.type === "hello") {
		void run();
		return;
	}
	if (frame.type !== "relay") return;
	const record = frame.record;
	if (record?.type === "response" && record.id && pending.has(record.id)) {
		const resolve = pending.get(record.id);
		pending.delete(record.id);
		resolve(record);
	}
});

async function run() {
	const before = await call({ type: "get_state" });
	console.log("before:", before.data?.model?.id, "|", before.data?.sessionFile?.split("\\").pop(), "|", before.data?.messageCount, "msgs");

	const list = await call({ type: "piwebui_list_sessions", limit: 20 });
	const sessions = list.data?.sessions ?? [];
	const cwds = [...new Set(sessions.map((s) => s.cwd))];
	console.log(`\n${sessions.length} sessions across ${cwds.length} projects:`);
	for (const cwd of cwds) console.log("  -", cwd);

	const cfg = await call({ type: "piwebui_get_config" });
	const currentCwd = cfg.data?.cwd;
	console.log("current cwd:", currentCwd);
	const target = sessions.find((s) => s.cwd !== currentCwd && s.messageCount > 2);
	if (!target) {
		console.log("no cross-project session found, skipping switch test");
		ws.close();
		process.exit(0);
	}

	console.log(`\nopening cross-project session: ${target.preview.slice(0, 40)} (${target.messageCount} msgs) @ ${target.cwd}`);
	const opened = await call({ type: "piwebui_open_session", sessionPath: target.path });
	console.log("open result:", JSON.stringify(opened.data ?? opened.error));

	await new Promise((r) => setTimeout(r, 3500));

	const after = await call({ type: "get_state" });
	console.log("after :", after.data?.model?.id, "|", after.data?.sessionFile?.split("\\").pop(), "|", after.data?.messageCount, "msgs");

	const messages = await call({ type: "get_messages" });
	console.log("restored messages:", messages.data?.messages?.length ?? 0);
	const firstUser = (messages.data?.messages ?? []).find((m) => m.role === "user" || m.message?.role === "user");
	console.log("first user text:", JSON.stringify(firstUser?.message?.content ?? firstUser?.content)?.slice(0, 120));

	ws.close();
	process.exit(0);
}

setTimeout(() => {
	console.error("timeout");
	process.exit(2);
}, 60_000);
