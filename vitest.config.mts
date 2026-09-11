import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// Integration tests need DATABASE_URL; unit tests ignore it.
config({ path: ".env.local", quiet: true });

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests share one database, so they must not race each other.
    fileParallelism: false,
    testTimeout: 20_000
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
