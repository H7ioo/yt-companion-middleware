import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api, /docs and /guide to the Express backend on :8080.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
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
