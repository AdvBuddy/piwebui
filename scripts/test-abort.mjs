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
let aborted = false;
let sawStart = false;
const started = Date.now();

ws.on("message", (data) => {
	const frame = JSON.parse(data.toString());
	if (frame.type === "hello") {
		ws.send(
			JSON.stringify({
				type: "relay",
				record: { id: "p1", type: "prompt", message: "从 1 慢慢数到 200，每个数字之间换行输出，不要调用工具。" },
			}),
		);
		return;
	}
	if (frame.type !== "relay") return;
	const record = frame.record;

	if (record.type === "agent_start") sawStart = true;
	if (record.type === "message_update" && record.assistantMessageEvent?.type === "text_delta" && !aborted) {
		// Abort once the model is clearly mid-stream.
		aborted = true;
		console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] aborting mid-stream`);
		ws.send(JSON.stringify({ type: "relay", record: { id: "a1", type: "abort" } }));
	}
	if (record.type === "agent_settled") {
		console.log("agent_settled:", JSON.stringify({ aborted: record.aborted, afterMs: Date.now() - started, sawStart }));
		ws.close();
		process.exit(record.aborted ? 0 : 3);
	}
});

setTimeout(() => {
	console.error("timeout waiting for agent_settled");
	process.exit(2);
}, 60_000);
