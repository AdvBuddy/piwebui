import { build } from "esbuild";

await build({
	entryPoints: ["src/index.ts"],
	outfile: "dist/index.js",
	bundle: true,
	platform: "node",
	target: "node20",
	format: "esm",
	sourcemap: true,
	// Runtime deps stay external so the server can be deployed with a plain
	// `npm ci --omit=dev`. The workspace `@piwebui/shared` package is TypeScript
	// and must be inlined, so it is deliberately absent from this list.
	external: ["hono", "@hono/node-server", "ws"],
	banner: {
		js: `import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);`,
	},
	logLevel: "info",
});
