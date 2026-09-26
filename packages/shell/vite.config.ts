import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The desktop shell's pure logic, bundled for the Electron main process.
 *
 * CommonJS rather than ESM: Electron's main process loads `main.cjs` with `require`, and a
 * `.cjs` entry keeps the Steam package free of the ESM/CJS interop that Electron's own loader
 * still handles inconsistently across versions.
 */
export default defineConfig({
  build: {
    outDir: r('../../dist/shell'),
    emptyOutDir: true,
    target: 'node20',
    ssr: true,
    sourcemap: false,
    lib: {
      entry: r('./src/index.ts'),
      formats: ['cjs'],
    },
  },
});
