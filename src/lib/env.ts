import { config } from "dotenv";

/**
 * `.env.local`, for the entry points Next.js does not start.
 *
 * Next reads `.env.local` by itself, so the application and every route in it
 * has always seen the file. Nothing else does. `drizzle-kit` and a `tsx`
 * script are plain Node processes, and they were reading an environment that
 * the documented setup had never put anything into:
 *
 *   - `.env.example` says "Copy to .env.local and fill in", so that is where
 *     `DATABASE_URL` ends up.
 *   - `DEPLOYMENT.md` then says to run `npm run db:migrate`, which is
 *     `drizzle-kit migrate`, which read `process.env.DATABASE_URL ?? ""` and
 *     failed with `[x] url: ''` — a message that names neither the file nor
 *     the variable it wanted.
 *   - `capture.mjs` says to run `npm run seed:demo` first, which threw
 *     "DATABASE_URL is not set" against a `.env.local` that plainly set it.
 *
 * Both failures were of the documented instructions, not of the operator, and
 * both landed on the first command of a first setup — the worst possible
 * moment for a misleading error. The two vitest configs already loaded the
 * file for exactly this reason; the other two entry points did not.
 *
 * **A variable already in the environment always wins.** That is `dotenv`'s
 * default and it is the half that matters in production, where the platform
 * sets `DATABASE_URL` and there is no `.env.local` at all: a file committed by
 * accident must never be able to point a running deploy at another database.
 * It is asserted in `env.test.ts` rather than left to a dependency's default.
 *
 * A missing file is not an error. Production has none, and that is the normal
 * case rather than a degraded one.
 */
export function loadLocalEnv(path = ".env.local"): void {
  config({ path, quiet: true, override: false });
}
