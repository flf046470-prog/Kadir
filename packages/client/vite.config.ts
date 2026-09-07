import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('.'),
  publicDir: r('./public'),
  resolve: {
    alias: [
      { find: /^@kc\/core$/, replacement: r('../core/src/index.ts') },
      { find: /^@kc\/core\//, replacement: r('../core/src/') },
      { find: /^@kc\/net$/, replacement: r('../net/src/index.ts') },
      { find: /^@kc\/net\//, replacement: r('../net/src/') },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: {
    outDir: r('../../dist/client'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
});
