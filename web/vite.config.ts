import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const RELAY = process.env.PIWEBUI_RELAY ?? "http://127.0.0.1:8787";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	build: {
		outDir: "../server/public",
		emptyOutDir: true,
		sourcemap: false,
		target: "es2022",
	},
	server: {
		port: 5173,
		proxy: {
			"/api": { target: RELAY, changeOrigin: true },
			"/ws": { target: RELAY, ws: true, changeOrigin: true },
		},
	},
});
