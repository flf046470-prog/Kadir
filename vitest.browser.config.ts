import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

/**
 * The browser tests, kept out of `npm test` on purpose.
 *
 * They need something the rest of the suite does not: a built application,
 * serving, with the demo data behind it. Folding them into the default run
 * would mean every `npm test` either builds the app first or fails with a
 * connection error — and a suite that cannot be run casually stops being run.
 *
 * `npm test` therefore stays the fast one. `npm run test:browser` is the one
 * that needs a server, and CI runs both.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.browser.test.ts"],
    // One browser, one server, shared state: these must not overlap.
    fileParallelism: false,
    // A cold Next.js route compiles on first request, and launching Chromium is
    // not instant either. Generous, because a timeout here reads as a product
    // failure and sends someone debugging the wrong thing.
    testTimeout: 60_000,
    hookTimeout: 60_000
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
