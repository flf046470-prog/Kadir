import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalEnv } from "./env";

const KEY = "FM_ENV_TEST_VALUE";
const directories: string[] = [];

/** A throwaway `.env.local` somewhere the repository's own file cannot be reached. */
function envFile(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), "fiorematch-env-"));
  directories.push(directory);
  const path = join(directory, ".env.local");
  writeFileSync(path, contents);
  return path;
}

afterEach(() => {
  delete process.env[KEY];
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("loading .env.local", () => {
  it("puts the file's variables into the environment", () => {
    loadLocalEnv(envFile(`${KEY}=from-the-file\n`));

    expect(process.env[KEY]).toBe("from-the-file");
  });

  /**
   * The half that matters in production.
   *
   * The platform sets `DATABASE_URL` and there is normally no `.env.local` at
   * all — but "normally" is not a guarantee, and a file committed by accident
   * or left in a build context must not be able to repoint a running deploy at
   * a development database. The real environment wins, always.
   */
  it("never overrides a variable the environment already has", () => {
    process.env[KEY] = "from-the-platform";

    loadLocalEnv(envFile(`${KEY}=from-the-file\n`));

    expect(process.env[KEY]).toBe("from-the-platform");
  });

  /** Production has no such file. That is the normal case, not a failure. */
  it("does nothing when there is no file", () => {
    expect(() => loadLocalEnv(join(tmpdir(), "fiorematch-absent", ".env.local"))).not.toThrow();
    expect(process.env[KEY]).toBeUndefined();
  });
});
