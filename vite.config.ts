import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The public REST API sends no CORS headers, so the browser never calls it
// directly: the Letterplate server (server/index.mjs) reads the chain and
// answers /api. In development Vite proxies /api to it.
//
// The dev server may only read the app's own files and node_modules, refuses
// keys and internal notes outright, listens on this machine only, and rejects
// cross-site requests.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    cors: false,
    fs: {
      strict: true,
      allow: [here("./src"), here("./index.html"), here("./public"), here("./node_modules")],
      deny: [".env", ".env.*", "*.{crt,pem,key}", "**/.keys/**", "**/.git/**", "**/receipts/**", "**/PROJECT_STATE.md", "**/HACK_EVENT_GATE.json"],
    },
    proxy: {
      "/api": "http://localhost:8787",
      // Development only, for the official QoreX wallet mock used in end-to-end
      // tests: the mock runs inside the page, so its testnet REST calls need a
      // same-origin path. The real QoreX extension calls the chain itself.
      // Never part of the production server.
      "/qore-rest": {
        target: "https://api-testnet.qore.host",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/qore-rest/, ""),
      },
    },
  },
  preview: { host: "localhost", cors: false, proxy: { "/api": "http://localhost:8787" } },
});
