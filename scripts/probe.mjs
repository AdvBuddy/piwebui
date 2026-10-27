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
let step = 0;

ws.on("message", (data) => {
	const frame = JSON.parse(data.toString());
	if (frame.type === "hello") {
		ws.send(JSON.stringify({ type: "relay", record: { id: "s1", type: "get_state" } }));
		ws.send(JSON.stringify({ type: "relay", record: { id: "m1", type: "get_available_models" } }));
		return;
	}
	if (frame.type !== "relay") return;
	const record = frame.record;
	if (record?.type !== "response") return;

	if (record.id === "s1") {
		const d = record.data ?? {};
		console.log(
			"state:",
			JSON.stringify({
				model: d.model?.id,
				isStreaming: d.isStreaming,
				messageCount: d.messageCount,
				thinkingLevel: d.thinkingLevel,
				input: d.model?.input,
				sessionName: d.sessionName,
			}),
		);
		step += 1;
	}
	if (record.id === "m1") {
		const models = record.data?.models ?? [];
		console.log(`\nmodels (${models.length}):`);
		for (const m of models) {
			console.log(
				`  ${m.provider.padEnd(16)} ${String(m.id).padEnd(28)} input=[${(m.input ?? []).join(",")}] reasoning=${m.reasoning ?? false}`,
			);
		}
		step += 1;
	}
	if (step >= 2) {
		ws.close();
		process.exit(0);
	}
});
setTimeout(() => process.exit(2), 10_000);
