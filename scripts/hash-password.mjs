#!/usr/bin/env node
/**
 * Generates a scrypt hash for ADMIN_PASSWORD_HASH.
 *
 *   npm run admin:password -- "a long passphrase"
 *
 * With no argument the password is read from stdin so it stays out of shell
 * history. The hash — not the password — goes into the environment.
 */
import crypto from "node:crypto";
import readline from "node:readline";

const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

function hash(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password.normalize("NFKC"), salt, PARAMS.keylen, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), derived.toString("base64")].join("$");
}

function report(password) {
  if (password.length < 12) {
    console.error("Use at least 12 characters.");
    process.exit(1);
  }
  console.log("\nADMIN_PASSWORD_HASH=" + hash(password) + "\n");
}

const fromArgs = process.argv.slice(2).join(" ").trim();
if (fromArgs) {
  report(fromArgs);
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("Password: ", (answer) => {
    rl.close();
    report(answer.trim());
  });
}
