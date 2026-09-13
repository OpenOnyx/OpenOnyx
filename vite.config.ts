import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // @xenova/transformers imports onnxruntime-node in Electron's renderer (Node-like env).
      // Redirect to onnxruntime-web (WASM) which works correctly in the browser context.
      'onnxruntime-node': 'onnxruntime-web',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@xenova') || id.includes('onnxruntime')) {
              return 'vendor-transformers';
            }
            if (id.includes('@codemirror') || id.includes('@lezer') || id.includes('codemirror') || id.includes('@replit/codemirror-vim')) {
              return 'vendor-codemirror';
            }
            if (id.includes('d3') || id.includes('cytoscape') || id.includes('dagre')) {
              return 'vendor-d3';
            }
            if (id.includes('mermaid')) {
              return 'vendor-mermaid';
            }
            if (id.includes('katex')) {
              return 'vendor-katex';
            }
            if (id.includes('yjs') || id.includes('y-') || id.includes('lib0')) {
              return 'vendor-yjs';
            }
            if (id.includes('react') || id.includes('react-dom')) {
              return 'vendor-react';
            }
          }
        },
      },
    },
  },
  optimizeDeps: {
    include: ['d3-force', 'd3', 'mermaid', 'react-colorful'],
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/real-plugin-bundles.test.ts"],
    environment: "node",
  },
});

