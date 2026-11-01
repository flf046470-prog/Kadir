import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Bundles the Node server (and its workspace sources) into one file. */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@kc\/core$/, replacement: r('../core/src/index.ts') },
      { find: /^@kc\/core\//, replacement: r('../core/src/') },
      { find: /^@kc\/net$/, replacement: r('../net/src/index.ts') },
      { find: /^@kc\/net\//, replacement: r('../net/src/') },
    ],
  },
  build: {
    ssr: true,
    target: 'node20',
    outDir: r('../../dist/server'),
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: r('./src/main.ts'),
      output: { entryFileNames: 'main.js', format: 'es' },
      external: ['ws'],
    },
  },
});
