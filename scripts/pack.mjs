#!/usr/bin/env node
/**
 * Builds a self-contained deploy tarball for the remote server.
 *
 *   node scripts/pack.mjs              # build everything, then pack
 *   node scripts/pack.mjs --skip-build # pack the dist folders already on disk
 *
 * The tarball expands to the same layout the systemd units expect:
 *
 *   piwebui-deploy/
 *     server/{package.json,dist,public,.env.example}
 *     whisper/{app.py,requirements.txt,.env.example}
 *     deploy/{install.sh,*.service,nginx.conf}
 *     README.md
 *
 * Deliberately excludes: source, node_modules, .env (secrets stay off the wire),
 * and the local agent-host bundle (that one runs on YOUR machine, not the server).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");

const STAGE = path.join(root, ".pack", "piwebui-deploy");
const OUT_DIR = path.join(root, ".pack");

function step(message) {
	process.stdout.write(`\n\x1b[36m▸ ${message}\x1b[0m\n`);
}

function fail(message) {
	process.stderr.write(`\n\x1b[31m✗ ${message}\x1b[0m\n`);
	process.exit(1);
}

function copy(from, to) {
	const source = path.join(root, from);
	if (!fs.existsSync(source)) fail(`missing ${from} — did the build run?`);
	fs.mkdirSync(path.dirname(path.join(STAGE, to)), { recursive: true });
	fs.cpSync(source, path.join(STAGE, to), { recursive: true });
}

// ── 1. build ────────────────────────────────────────────────────────────
if (skipBuild) {
	step("skipping build (--skip-build)");
} else {
	step("building web + server + agent-host");
	// On Windows npm is an `npm.cmd` shim; spawning it directly fails with ENOENT,
	// and since Node's CVE-2024-27980 fix a .cmd also requires `shell: true`.
	const win = process.platform === "win32";
	execFileSync(win ? "npm.cmd" : "npm", ["run", "build"], {
		cwd: root,
		stdio: "inherit",
		shell: win,
	});
}

// ── 2. verify artifacts ─────────────────────────────────────────────────
step("verifying artifacts");
const mustExist = [
	"server/dist/index.js",
	"server/public/index.html",
	"agent-host/dist/agent-host.js",
];
for (const file of mustExist) {
	if (!fs.existsSync(path.join(root, file))) fail(`missing build artifact: ${file}`);
}

// ── 3. stage ────────────────────────────────────────────────────────────
step("staging");
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

const upstream = JSON.parse(fs.readFileSync(path.join(root, "server/package.json"), "utf8"));

// The server bundle keeps hono/@hono/node-server/ws external (esbuild `external`),
// so they must be installed on the server. Everything else is inlined.
const serverPackage = {
	name: "piwebui-server",
	version: upstream.version,
	private: true,
	type: "module",
	main: "dist/index.js",
	scripts: { start: "node dist/index.js" },
	dependencies: {
		"@hono/node-server": upstream.dependencies["@hono/node-server"],
		hono: upstream.dependencies.hono,
		ws: upstream.dependencies.ws,
	},
	engines: { node: ">=20" },
};

fs.mkdirSync(path.join(STAGE, "server"), { recursive: true });
fs.writeFileSync(
	path.join(STAGE, "server/package.json"),
	JSON.stringify(serverPackage, null, 2) + "\n",
);
copy("server/dist", "server/dist");
copy("server/public", "server/public");
copy("server/.env.example", "server/.env.example");

copy("whisper/app.py", "whisper/app.py");
copy("whisper/requirements.txt", "whisper/requirements.txt");
copy("whisper/.env.example", "whisper/.env.example");

copy("deploy", "deploy");
copy("README.md", "README.md");

// Source maps are a debugging aid, not a runtime dependency — and they embed the
// original TypeScript. Strip them so the deploy artifact carries no source.
function stripMaps(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) stripMaps(full);
		else if (entry.name.endsWith(".map")) fs.rmSync(full, { force: true });
	}
}
stripMaps(STAGE);

// agent-host 的构建产物不打包（它跑在你自己的机器上），但把启动脚本一起带上，
// 这样用户可以把整个包解压到本地来部署桥接端。
copy("agent-host/.env.example", "agent-host/.env.example");

// ── 4. tarball ──────────────────────────────────────────────────────────
step("creating tarball");
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const name = `piwebui-deploy-${stamp}.tar.gz`;
const outFile = path.join(OUT_DIR, name);

// `tar` ships with Windows 10+ (bsdtar) and every Linux/macOS box; no npm dep needed.
// Run it with a relative filename and an explicit cwd: GNU tar on Windows reads the
// "C:" in an absolute path as a remote host and fails with "Cannot connect to C:".
execFileSync("tar", ["-czf", name, "piwebui-deploy"], { cwd: OUT_DIR, stdio: "inherit" });

const bytes = fs.statSync(outFile).size;
const kb = (bytes / 1024).toFixed(0);

process.stdout.write(
		`\n\x1b[32m✓ ${name}\x1b[0m  (${kb} KB)\n` +
		`  ${outFile}\n\n` +
		`  Deploy:\n` +
		`    scp .pack/${name} you@server:/tmp/\n` +
		`    ssh you@server\n` +
		`    tar -xzf /tmp/${name} -C /tmp\n` +
		`    sudo bash /tmp/piwebui-deploy/deploy/install.sh\n\n`,
);
