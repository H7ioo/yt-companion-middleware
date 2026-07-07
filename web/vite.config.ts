import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api, /docs and /guide to the Express backend on :8080.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // WebSocket push must be listed before "/api" and flagged ws:true so the upgrade is
      // forwarded rather than swallowed by the HTTP proxy.
      "/api/dashboard/ws": { target: "ws://localhost:8080", ws: true },
      "/api/feedback/ws": { target: "ws://localhost:8080", ws: true },
      "/api": "http://localhost:8080",
      "/docs": "http://localhost:8080",
      "/guide": "http://localhost:8080",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
