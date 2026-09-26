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
    /**
     * `hidden`: the maps are written but no `sourceMappingURL` comment points at them.
     *
     * A minified stack trace from somebody's headset names `t` and `e` and is close to useless,
     * so the maps have to exist to be uploaded to Sentry. `hidden` rather than `true` because
     * nothing should fetch them at runtime — that is a download on a device whose startup budget
     * is a store requirement. Uploading them needs a Sentry auth token, which is a real secret
     * and belongs in the build environment, never in the client.
     */
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        // `sentry` is named rather than left to the hash so the precache builder can exclude it
        // by name. It is reached only by a dynamic import and must stay that way: precaching it
        // would have the service worker download the crash reporter during install, which is the
        // startup budget the lazy import exists to protect.
        manualChunks: { three: ['three'], sentry: ['@sentry/browser'] },
      },
    },
  },
});
