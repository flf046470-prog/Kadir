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
    // `scripts/` is included because the packaging tooling grew real logic — a PNG codec, store
    // manifest rules — and tooling that is only exercised by running it is tooling that breaks
    // on the day of a submission.
    include: ['packages/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: ['default'],
  },
});
