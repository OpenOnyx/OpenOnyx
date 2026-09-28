import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const appRoot = path.resolve(__dirname, "..");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(appRoot, "src"),
      electron: path.resolve(__dirname, "src/shims/electron.ts"),
      "onnxruntime-node": "onnxruntime-web",
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 4173,
    strictPort: true,
    host: true,
    fs: { allow: [appRoot] },
  },
  optimizeDeps: {
    include: ["d3-force", "d3", "mermaid", "react-colorful"],
    exclude: ["electron"],
  },
  worker: {
    format: "es",
  },
});
