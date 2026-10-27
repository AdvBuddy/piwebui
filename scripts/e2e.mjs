import WebSocket from "ws";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const TOKEN = process.env.TOKEN ?? "";

function log(...args) {
	console.log(...args);
}

const loginRes = await fetch(`${BASE}/api/login`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ token: TOKEN }),
});
if (!loginRes.ok) {
	console.error("login failed", loginRes.status, await loginRes.text());
	process.exit(1);
}
const cookies = loginRes.headers.getSetCookie?.() ?? [];
const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
log("login ok, cookie:", cookie.slice(0, 40) + "…");

const statusRes = await fetch(`${BASE}/api/status`, { headers: { cookie } });
log("status:", await statusRes.text());

const wsUrl = BASE.replace("http", "ws") + "/ws";
const ws = new WebSocket(wsUrl, { headers: { cookie } });

let reqId = 0;
const events = [];
const send = (record) => {
	reqId += 1;
	const id = `t${reqId}`;
	ws.send(JSON.stringify({ type: "relay", record: { ...record, id } }));
	return id;
};

let phase = "hello";
let textBuffer = "";
const started = Date.now();

ws.on("open", () => log("ws open"));
ws.on("error", (error) => console.error("ws error", error.message));

ws.on("message", (data) => {
	const frame = JSON.parse(data.toString());
	if (frame.type === "hello") {
		log("hello:", JSON.stringify(frame));
		if (phase !== "hello") return;
		phase = "state";
		send({ type: "get_state" });
		send({ type: "get_available_models" });
		send({ type: "piwebui_list_sessions", limit: 5 });
		return;
	}
	if (frame.type === "agent_status") {
		log("agent_status:", JSON.stringify(frame));
		return;
	}
	if (frame.type === "error") {
		console.error("server error:", frame.message);
		return;
	}
	if (frame.type !== "relay") return;

	const record = frame.record;
	const type = record?.type;

	if (type === "response") {
		if (record.command === "get_state") {
			log("state:", JSON.stringify(record.data?.model ?? record.data, null, 2).slice(0, 400));
			if (phase === "state") {
				phase = "prompting";
				setTimeout(() => {
					log("\n--- sending prompt ---");
					send({ type: "prompt", message: "用一句话说明你当前的工作目录里有哪些文件夹，不要调用任何工具。" });
				}, 300);
			}
		} else if (record.command === "get_available_models") {
			log("models:", (record.data?.models ?? []).length, "available");
		} else if (record.command === "piwebui_list_sessions") {
			log("sessions:", (record.data?.sessions ?? []).length, "found");
		} else if (!record.success) {
			console.error("command failed:", record.command, record.error);
		}
		return;
	}

	if (type === "extension_ui_request") {
		log("EXTENSION UI:", record.method, record.title ?? record.message ?? "");
		if (record.method === "confirm") {
			ws.send(JSON.stringify({ type: "relay", record: { type: "extension_ui_response", id: record.id, confirmed: true } }));
		} else if (record.method === "select") {
			ws.send(JSON.stringify({ type: "relay", record: { type: "extension_ui_response", id: record.id, value: record.options?.[0] } }));
		}
		return;
	}

	if (type === "message_update") {
		const ev = record.assistantMessageEvent;
		if (ev?.type === "text_delta") {
			textBuffer += ev.delta;
			process.stdout.write(ev.delta);
		} else if (ev?.type === "thinking_delta") {
			// keep quiet
		} else if (ev?.type === "toolcall_start") {
			process.stdout.write(`\n[tool:${ev.toolName}]`);
		}
		return;
	}

	if (type === "tool_execution_start") {
		log(`\n>> tool ${record.toolName}`, JSON.stringify(record.args ?? {}).slice(0, 160));
		return;
	}
	if (type === "tool_execution_end") {
		log(`<< tool ${record.toolName} ${record.isError ? "ERROR" : "ok"} ${record.durationMs ?? "?"}ms`);
		return;
	}

	if (type === "agent_settled") {
		log("\n\n=== agent_settled ===");
		log(`elapsed ${((Date.now() - started) / 1000).toFixed(1)}s, chars=${textBuffer.length}`);
		fs.writeFileSync("e2e-output.txt", textBuffer);
		ws.close();
		process.exit(0);
	}
});

setTimeout(() => {
	console.error("\n[timeout] no agent_settled within 90s");
	log("events seen:", events.slice(-10));
	ws.close();
	process.exit(2);
}, 90_000);
