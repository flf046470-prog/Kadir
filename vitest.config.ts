import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@kc\/core$/, replacement: r('./packages/core/src/index.ts') },
      { find: /^@kc\/core\//, replacement: r('./packages/core/src/') },
      { find: /^@kc\/net$/, replacement: r('./packages/net/src/index.ts') },
      { find: /^@kc\/net\//, replacement: r('./packages/net/src/') },
    ],
  },
  test: {
    include: ['packages/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
  },
});
