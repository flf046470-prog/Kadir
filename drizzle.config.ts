import type { Config } from "drizzle-kit";
import { loadLocalEnv } from "./src/lib/env";

// drizzle-kit is a plain Node process, so nothing has read `.env.local` — the
// file `.env.example` tells you to create and put `DATABASE_URL` in. Without
// this, `npm run db:migrate` on a correctly configured checkout failed with
// `[x] url: ''`, which names neither the file nor the variable it wanted.
loadLocalEnv();

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? ""
  }
} satisfies Config;
