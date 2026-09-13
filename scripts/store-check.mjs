import { readFile, stat, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * The pre-release store compliance report (§51).
 *
 * Three listings, three sets of rules, and a copy of the same facts in each —
 * package identifier, product ids, support address, the character counts under
 * every block. Nothing keeps those in step, and the failure mode is not a
 * crash: it is a submission rejected days later for a number somebody typed by
 * hand and never revisited. This repository has already lost that argument once
 * — a pricing screenshot stayed live for months after the pricing changed.
 *
 * So this checks what the repository can *prove about itself*: that the copies
 * agree, that the compliance surfaces the stores require actually exist as
 * routes, and that the screenshots are not older than the thing they show.
 *
 * **What it deliberately does not do is assert current store limits from
 * memory.** §51 is explicit about not assuming outdated requirements, and a
 * hardcoded "80 characters" here would be exactly that — an unsourced number
 * that looks authoritative and silently rots. Instead the limits are read out
 * of the listing headings, where they sit beside the copy they govern and next
 * to the note saying where they came from. Confirming them against the stores'
 * current documentation is a human step, and `submission.md` is where it is
 * written down.
 *
 *   npm run store:check
 *
 * Exits non-zero on a blocker, so it can gate a release.
 */

const ROOT = process.cwd();

const findings = [];
const record = (level, area, message) => findings.push({ level, area, message });
const blocker = (area, message) => record("blocker", area, message);
const warn = (area, message) => record("warning", area, message);
const ok = (area, message) => record("ok", area, message);

const read = (path) => readFile(join(ROOT, path), "utf8");
const exists = (path) =>
  stat(join(ROOT, path)).then(
    () => true,
    () => false
  );

const LISTINGS = {
  "Play Store": "mobile/play-store/listing.md",
  "App Store": "mobile/app-store/listing.md",
  "Microsoft Store": "mobile/microsoft-store/listing.md"
};

/**
 * Every field in a listing that declares a limit, with the copy under it.
 *
 * The heading carries the limit — `## Kısa açıklama  (80 karakter sınırı)` —
 * and the fenced block under it carries the text. The line after the block is a
 * hand-written counter (`67 / 80`), which is the part most likely to be wrong,
 * because nothing recomputes it when the copy is edited.
 */
function parseListing(markdown) {
  const fields = [];
  const pattern =
    /^##+\s+(.+?)\s*\((\d[\d.]*)\s*karakter[^)]*\)\s*$\n+```\n([\s\S]*?)\n```(?:\n(\d+)\s*\/\s*(\d[\d.]*))?/gm;

  for (const match of markdown.matchAll(pattern)) {
    fields.push({
      name: match[1].trim(),
      limit: Number(match[2].replace(/\./g, "")),
      text: match[3],
      claimedCount: match[4] ? Number(match[4]) : null
    });
  }
  return fields;
}

async function checkListingCopy() {
  for (const [store, path] of Object.entries(LISTINGS)) {
    if (!(await exists(path))) {
      blocker("store metadata", `${store}: ${path} is missing`);
      continue;
    }

    const fields = parseListing(await read(path));
    if (fields.length === 0) {
      warn("store metadata", `${store}: no fields with a declared character limit were found`);
      continue;
    }

    for (const field of fields) {
      // The unit the stores count in is characters as a person sees them, so
      // an emoji or a Turkish "ğ" is one. `Array.from` counts code points
      // rather than UTF-16 units, which `.length` would get wrong.
      const actual = Array.from(field.text).length;

      if (actual > field.limit) {
        blocker(
          "store metadata",
          `${store} · ${field.name}: ${actual} characters, over the ${field.limit} limit`
        );
      } else if (field.claimedCount !== null && field.claimedCount !== actual) {
        // Not a rejection on its own, but it means the counter under the copy
        // is stale — and that counter is what somebody trusts instead of
        // counting when they paste it in.
        warn(
          "store metadata",
          `${store} · ${field.name}: the note says ${field.claimedCount} characters, it is ${actual}`
        );
      } else {
        ok("store metadata", `${store} · ${field.name}: ${actual}/${field.limit}`);
      }
    }
  }
}

/** One identifier, named in four places that cannot be allowed to disagree. */
async function checkIdentifiers() {
  const sources = {
    "capacitor.config.ts": "capacitor.config.ts",
    "Android build.gradle": "mobile/android/app/build.gradle",
    "iOS project": "mobile/ios/App/App.xcodeproj/project.pbxproj"
  };

  const found = new Map();
  for (const [label, path] of Object.entries(sources)) {
    if (!(await exists(path))) {
      warn("package identifiers", `${label}: ${path} not present, skipped`);
      continue;
    }
    const ids = [...(await read(path)).matchAll(/com\.fiorematch\.[a-z0-9.]+/g)]
      .map((m) => m[0])
      // Product ids live in the same namespace; the application id is the
      // shortest of them and the only one being compared here.
      .filter((id) => !id.includes(".plus.") && !id.includes(".vip."));
    for (const id of new Set(ids)) found.set(label, id);
  }

  const distinct = new Set(found.values());
  if (distinct.size === 0) {
    warn("package identifiers", "no application id was found to compare");
  } else if (distinct.size > 1) {
    blocker(
      "package identifiers",
      `they disagree: ${[...found].map(([k, v]) => `${k}=${v}`).join(", ")}`
    );
  } else {
    ok("package identifiers", `${[...distinct][0]} in ${found.size} places`);
  }
}

/** The product ids the code sells must be the ones the listings promise. */
async function checkProducts() {
  const source = await read("src/lib/billing/purchase.ts");
  const inCode = [...source.matchAll(/"(com\.fiorematch\.app\.(?:plus|vip)\.[a-z]+)"/g)].map(
    (m) => m[1]
  );

  if (inCode.length === 0) {
    blocker("subscriptions", "no product ids found in src/lib/billing/purchase.ts");
    return;
  }
  ok("subscriptions", `${inCode.length} product ids defined: ${inCode.join(", ")}`);

  for (const [store, path] of Object.entries(LISTINGS)) {
    const text = await read(path).catch(() => "");
    const mentioned = inCode.filter((id) => text.includes(id));
    // A listing that names none is fine — not every store's copy quotes the
    // raw ids. One that names *some* has a partial list, which is how a
    // renamed product ends up configured in one store and not another.
    if (mentioned.length > 0 && mentioned.length < inCode.length) {
      warn(
        "subscriptions",
        `${store}: names ${mentioned.length} of ${inCode.length} product ids`
      );
    }
  }
}

/** One support address, and every listing has to carry the same one. */
async function checkSupportEmail() {
  const site = await read("src/lib/site.ts");
  const match = site.match(/supportEmail\s*=\s*"([^"]+)"/);
  if (!match) {
    blocker("store metadata", "supportEmail is not defined in src/lib/site.ts");
    return;
  }
  const address = match[1];

  for (const [store, path] of Object.entries(LISTINGS)) {
    const text = await read(path).catch(() => "");
    const addresses = new Set(
      [...text.matchAll(/[a-zA-Z0-9._%+-]+@fiorematch\.com/g)].map((m) => m[0])
    );

    if (addresses.size === 0) {
      warn("store metadata", `${store}: no support address in the listing`);
    } else if (![...addresses].every((found) => found === address)) {
      // Every store requires a working support contact, and one pointing at a
      // mailbox nobody owns is a rejection.
      blocker(
        "store metadata",
        `${store}: names ${[...addresses].join(", ")}, but the app's address is ${address}`
      );
    } else {
      ok("store metadata", `${store}: support address matches (${address})`);
    }
  }
}

/**
 * The surfaces the stores require to exist, checked as routes rather than as
 * claims in a document.
 *
 * Apple 5.1.1(v) wants account deletion inside the app; every store's dating
 * policy wants reporting and blocking; the age gate is what the 18+ rating
 * rests on. A listing can assert all of this; only the routes make it true.
 */
async function checkComplianceSurfaces() {
  const required = [
    ["account deletion", "src/app/api/account/route.ts", /export async function DELETE/],
    ["reporting", "src/app/api/reports/route.ts", /export async function POST/],
    ["blocking", "src/app/api/blocks/route.ts", /export async function POST/],
    ["age rating", "src/auth/accounts.ts", /18|MINIMUM_AGE|minimumAge/]
  ];

  for (const [area, path, pattern] of required) {
    if (!(await exists(path))) {
      blocker(area, `${path} does not exist`);
      continue;
    }
    if (!pattern.test(await read(path))) {
      blocker(area, `${path} exists but does not implement what the stores require`);
    } else {
      ok(area, `${path}`);
    }
  }
}

/** PNGs anywhere beneath a directory, however the store wants them arranged. */
async function countPngs(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) total += await countPngs(join(dir, entry.name));
    else if (entry.name.toLowerCase().endsWith(".png")) total += 1;
  }
  return total;
}

/** Assets each store will refuse the upload without. */
async function checkAssets() {
  const required = [
    ["Play Store", "mobile/play-store/assets", ["app-icon-512.png", "feature-graphic-1024x500.png"]],
    ["App Store", "mobile/app-store/assets", []],
    ["Microsoft Store", "mobile/microsoft-store/assets", []]
  ];

  for (const [store, dir, files] of required) {
    if (!(await exists(dir))) {
      blocker("icons", `${store}: ${dir} is missing`);
      continue;
    }
    for (const file of files) {
      if (!(await exists(join(dir, file)))) blocker("icons", `${store}: ${file} is missing`);
    }

    /**
     * Counted recursively, because the three stores disagree about layout and
     * both shapes are correct: Play takes one flat set, Apple wants a folder
     * per device size, Microsoft separates listing art from the package. A
     * check that assumed one of them would report the other two as broken —
     * which is how a report trains people to skim past it.
     */
    const shots = await countPngs(join(ROOT, dir));
    if (shots === 0) {
      blocker("screenshots", `${store}: no screenshots under ${dir}`);
    } else {
      ok("screenshots", `${store}: ${shots} screenshots`);
    }
  }
}

/**
 * Screenshots older than what they show.
 *
 * This is the failure that already happened here: the pricing changed, the
 * capture did not, and a listing whose screenshots contradict its description
 * is a rejection only a human finds. Comparing modification times is crude and
 * it is enough — the question is only ever "was this shot before or after the
 * thing in it changed".
 */
async function checkScreenshotFreshness() {
  const sources = ["src/lib/billing/tiers.ts", "src/i18n/messages/tr.json"];
  const captures = "mobile/captures";

  if (!(await exists(captures))) {
    warn("screenshots", "mobile/captures is missing; nothing to compare");
    return;
  }

  let newestSource = 0;
  let newestName = "";
  for (const path of sources) {
    if (!(await exists(path))) continue;
    const { mtimeMs } = await stat(join(ROOT, path));
    if (mtimeMs > newestSource) {
      newestSource = mtimeMs;
      newestName = path;
    }
  }

  const shots = await readdir(join(ROOT, captures));
  const stale = [];
  for (const name of shots.filter((n) => n.endsWith(".png"))) {
    const { mtimeMs } = await stat(join(ROOT, captures, name));
    if (mtimeMs < newestSource) stale.push(name);
  }

  if (stale.length > 0) {
    warn(
      "screenshots",
      `${stale.length} capture(s) predate ${newestName} — re-run npm run capture: ${stale.join(", ")}`
    );
  } else if (shots.length > 0) {
    ok("screenshots", `all ${shots.length} captures are newer than the copy they show`);
  }
}

/** Signing, without ever wanting the key itself. */
async function checkSigning() {
  const doc = await read("mobile/play-store/submission.md").catch(() => "");
  if (/keystore|imzala|signing/i.test(doc)) {
    ok("signing", "the signing procedure is documented in play-store/submission.md");
  } else {
    warn("signing", "no signing procedure found in play-store/submission.md");
  }
}

async function main() {
  await checkListingCopy();
  await checkIdentifiers();
  await checkProducts();
  await checkSupportEmail();
  await checkComplianceSurfaces();
  await checkAssets();
  await checkScreenshotFreshness();
  await checkSigning();

  const byLevel = (level) => findings.filter((f) => f.level === level);
  const blockers = byLevel("blocker");
  const warnings = byLevel("warning");

  console.log("\nStore compliance report\n");

  for (const level of ["blocker", "warning", "ok"]) {
    const rows = byLevel(level);
    if (rows.length === 0) continue;
    const mark = level === "blocker" ? "✗" : level === "warning" ? "!" : "·";
    console.log(level === "ok" ? "\nPassed" : `\n${level.toUpperCase()}`);
    for (const row of rows) console.log(`  ${mark} ${row.area.padEnd(20)} ${row.message}`);
  }

  console.log(
    `\n${blockers.length} blocker(s), ${warnings.length} warning(s), ${byLevel("ok").length} passed\n`
  );

  /**
   * The limits above were read from the listings, not from the stores. Printed
   * every run rather than buried, because §51's actual instruction is not to
   * assume a requirement is current — and a report that looked complete would
   * be the thing that made someone stop checking.
   */
  console.log(
    "Character limits come from the listing headings. Confirm them, and the\n" +
      "policies in each submission.md, against the stores' current documentation\n" +
      "before submitting. This report cannot do that for you.\n"
  );

  process.exit(blockers.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
