import { build } from "esbuild";

await build({
	entryPoints: ["src/index.ts"],
	outfile: "dist/agent-host.js",
	bundle: true,
	platform: "node",
	target: "node20",
	format: "esm",
	sourcemap: true,
	// ws lazily requires these optional native addons; keep them external so the
	// bundle stays portable across machines without a native toolchain.
	external: ["ws", "bufferutil", "utf-8-validate"],
	banner: {
		js: `import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);`,
	},
	logLevel: "info",
});
