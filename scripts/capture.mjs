import { chromium } from "playwright";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * The store screenshots, as a command rather than an afternoon.
 *
 * These used to be taken by hand. The cost of that showed up as a pricing
 * screenshot that still showed the old plan months after the plan changed:
 * nothing failed, nothing warned, the file was simply older than the copy
 * beside it. A listing whose screenshots contradict its description is a
 * rejection at review, and it is the kind that is only found by a human.
 *
 * So the captures are derived, and the store folders are derived from them.
 * Change the pricing page, run this, run `npm run store:assets`, and all three
 * stores agree because none of them holds an independent copy of anything.
 *
 * Needs the demo data and a server:
 *
 *   npm run seed:demo                  # prints a session cookie
 *   npm run build && npm run start
 *   FM_SESSION=<token> npm run capture
 *
 * Marketing pages are captured with or without the cookie. The signed-in
 * screens are skipped without it, loudly, rather than silently producing five
 * screenshots of a login form.
 */

const BASE = process.env.FM_BASE_URL ?? "http://127.0.0.1:3100";
const SESSION = process.env.FM_SESSION ?? "";
const LOCALE = process.env.FM_LOCALE ?? "tr";

/**
 * Chromium comes from the image rather than from a Playwright download.
 *
 * The sandbox ships a browser and sets `PLAYWRIGHT_BROWSERS_PATH`, but the
 * revision it ships does not always match the one this Playwright expects, and
 * the mismatch fails as "run npx playwright install" — which is exactly what
 * must not happen in a sandbox with no egress. An explicit path is checked
 * first and falls back to whatever Playwright resolves on a normal machine.
 */
const EXECUTABLE = process.env.CHROMIUM_PATH ?? undefined;

/**
 * The two shapes a store asks for, and why these numbers.
 *
 * Phone is 1080×1920 because that is the raw size Play takes unmodified and
 * the size `mobile/app-store/screenshots.mjs` composes Apple's from. Desktop is
 * 1366×768 because that is Microsoft's floor for a Store screenshot; going
 * under it is a rejected upload, and going over it only adds bytes, since
 * Partner Center scales for display anyway.
 *
 * The phone is shot at a device scale factor of 3 rather than at a 1080-wide
 * viewport: a 1080px-wide browser window is a *desktop* layout, and the phone
 * screenshots would show the desktop breakpoint at phone dimensions.
 */
const SHAPES = [
  {
    name: "phone",
    out: "mobile/captures",
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: 3,
    isMobile: true
  },
  {
    name: "desktop",
    out: "mobile/captures-desktop",
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    isMobile: false
  }
];

/**
 * What to shoot.
 *
 * `settle` is a selector that must be on the page before the shutter, not a
 * timeout. Discover and the conversation both fetch after first paint, and a
 * fixed wait is the thing that passes on a warm machine and ships a spinner
 * from a cold one.
 */
const TARGETS = [
  {
    file: "01-kesfet",
    path: `/${LOCALE}/app/discover`,
    auth: true,
    settle: "text=/Neden|Why/i",
    /**
     * Framed on the card, not the page.
     *
     * Above the card sit the mode selector, the filter summary and the boost
     * button — controls, all of them empty on a fresh account, which between
     * them ate the top half of the shot and pushed the match reasons under the
     * fold. The reasons are the thing this screenshot is for: every competitor
     * shows a photo and a name, and what is different here is the sentence
     * saying why this person is on screen.
     */
    scrollTo: "article"
  },
  {
    file: "02-gunun-5i",
    path: `/${LOCALE}/app/daily-five`,
    auth: true
  },
  {
    file: "03-otomatik-ceviri",
    path: `/${LOCALE}/app/matches`,
    auth: true,
    // Open the one conversation rather than the list: the translated thread is
    // the screenshot, and the list is a list of one row.
    click: "a[href*='/app/matches/']",
    /**
     * Back to the top after the thread jumps to the newest message.
     *
     * A conversation view scrolls to the bottom on open, which is right for
     * reading and wrong for this screenshot: it frames the composer and the
     * games panel, and pushes the translated messages — and the notice saying
     * why they are translated — off the top of a phone-sized viewport.
     */
    scrollTo: "top",
    // The Turkish of the first German line. Waiting on the translated text
    // rather than on the thread means a run with no translation provider fails
    // here, loudly, instead of shipping a screenshot of the feature switched
    // off under a filename that says it is on.
    settle: "text=Profilin beni gülümsetti"
  },
  {
    file: "04-seni-begenenler",
    path: `/${LOCALE}/app/matches`,
    auth: true
  },
  {
    file: "05-fiyatlandirma",
    path: `/${LOCALE}/pricing`,
    auth: false,
    /**
     * Scrolled to the plans, by the card's own heading.
     *
     * The unscrolled page is the hero and a subtitle, which is what the
     * previous screenshot showed: no price appeared anywhere in a screenshot
     * whose one job was to show the prices.
     *
     * `text-is` rather than `text=`, and the heading rather than the word.
     * "PLUS" also occurs in the subtitle at the top of the page, so a
     * substring match resolves to something already on screen and scrolls
     * nowhere — which is the bug this line was written to fix, reintroduced.
     */
    scrollTo: 'h3:text-is("PLUS")'
  }
];

async function shoot(context, shape, target, dir) {
  const page = await context.newPage();
  const url = `${BASE}${target.path}`;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

  if (target.click) {
    const link = page.locator(target.click).first();
    await link.waitFor({ state: "visible", timeout: 15_000 });
    await link.click();
    await page.waitForLoadState("domcontentloaded");
  }

  if (target.settle) {
    await page.locator(target.settle).first().waitFor({ state: "visible", timeout: 15_000 });
  }

  if (target.scrollTo === "top") {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(150);
  } else if (target.scrollTo) {
    const anchor = page.locator(target.scrollTo).first();
    await anchor.waitFor({ state: "visible", timeout: 15_000 });
    /**
     * Put the anchor at the top of the frame, not merely inside it.
     *
     * `scrollIntoViewIfNeeded` does the least it can — for an element already
     * on screen, nothing at all — so the plan the shot is framed around ends up
     * wherever it happened to be. Aligning to the top is what makes the framing
     * a decision rather than an accident of page length.
     *
     * The offset is measured rather than guessed. The site header is sticky, so
     * scrolling an element to y=0 files it *underneath* the header — which is
     * how the first attempt at this produced a pricing card with its plan name
     * sliced in half by the nav bar. Whatever is pinned to the top of the
     * viewport is found and its height becomes the margin.
     */
    await anchor.evaluate((node) => {
      const pinned = Array.from(document.querySelectorAll("header, [class*='sticky']"))
        .filter((el) => {
          const style = getComputedStyle(el);
          return style.position === "sticky" || style.position === "fixed";
        })
        .map((el) => el.getBoundingClientRect().height);

      // The extra 56 is for what sits *above* the anchor inside its own card —
      // the "most complete" badge is absolutely positioned past the card's top
      // edge, so aligning the heading under the header still clips the badge.
      const clearance = pinned.length > 0 ? Math.max(...pinned) : 0;
      const top = node.getBoundingClientRect().top + window.scrollY - clearance - 56;
      window.scrollTo({ top: Math.max(top, 0), behavior: "instant" });
    });
    await page.waitForTimeout(150);
  }

  // Web fonts and the gradient backdrop land a frame after layout; without
  // this the mark and the display face occasionally shoot mid-swap.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  const file = join(dir, `${target.file}.png`);
  await page.screenshot({ path: file, type: "png" });
  await page.close();

  return file;
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const shot = [];
  const skipped = [];

  for (const shape of SHAPES) {
    const dir = join(process.cwd(), shape.out);
    await mkdir(dir, { recursive: true });

    const context = await browser.newContext({
      viewport: shape.viewport,
      deviceScaleFactor: shape.deviceScaleFactor,
      isMobile: shape.isMobile,
      hasTouch: shape.isMobile,
      locale: LOCALE,
      colorScheme: "light"
    });

    if (SESSION) {
      const { hostname } = new URL(BASE);
      await context.addCookies([
        { name: "fm_session", value: SESSION, domain: hostname, path: "/" }
      ]);
    }

    console.log(`\n${shape.name}  ${shape.viewport.width}×${shape.viewport.height} @${shape.deviceScaleFactor}x`);

    for (const target of TARGETS) {
      if (target.auth && !SESSION) {
        skipped.push(`${shape.name}/${target.file}`);
        console.log(`  ${target.file.padEnd(22)} skipped — needs FM_SESSION`);
        continue;
      }

      try {
        const file = await shoot(context, shape, target, dir);
        shot.push(file);
        console.log(`  ${target.file.padEnd(22)} ${file.replace(process.cwd() + "/", "")}`);
      } catch (error) {
        // One unreachable screen must not cost the other nine. The summary
        // below is what decides whether the run was usable.
        skipped.push(`${shape.name}/${target.file}`);
        console.log(`  ${target.file.padEnd(22)} FAILED — ${error.message.split("\n")[0]}`);
      }
    }

    await context.close();
  }

  await browser.close();

  /**
   * The four the web manifest names, copied into `public/`.
   *
   * `src/app/manifest.ts` lists screenshots so the install prompt and the
   * Microsoft Store listing have something to show, and a manifest entry whose
   * file is missing is a broken image in an install dialog. Copying them here
   * rather than maintaining a second set is what stops the install prompt and
   * the store listing from drifting apart — there is one set of captures, and
   * everything downstream is derived from it.
   */
  const PUBLISHED = [
    ["mobile/captures-desktop/01-kesfet.png", "desktop-discover.png"],
    ["mobile/captures-desktop/03-otomatik-ceviri.png", "desktop-translation.png"],
    ["mobile/captures/01-kesfet.png", "phone-discover.png"],
    ["mobile/captures/03-otomatik-ceviri.png", "phone-translation.png"]
  ];

  const publicDir = join(process.cwd(), "public", "screenshots");
  await mkdir(publicDir, { recursive: true });

  let published = 0;
  for (const [from, to] of PUBLISHED) {
    try {
      await copyFile(join(process.cwd(), from), join(publicDir, to));
      published += 1;
    } catch {
      // A screen that failed above has no file to copy. Already counted as a
      // failure there; not worth reporting the same problem twice.
    }
  }
  console.log(`\n${published}/${PUBLISHED.length} copied to public/screenshots/`);

  console.log(`${shot.length} captured, ${skipped.length} skipped or failed`);
  if (skipped.length > 0) {
    console.log(`  ${skipped.join(", ")}`);
    // A partial run must not look like a clean one to a script that chains
    // this into `store:assets`.
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
