import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type ConsoleMessage, type Page } from "playwright";

/**
 * The tests that need a real browser.
 *
 * Everything else in this repository is unit or database tests, and they cover
 * what they can: the matching engine, the entitlement rules, every query. What
 * they structurally cannot see is the half of a Next.js application that only
 * exists once a browser runs it — hydration, client components, the middleware's
 * locale routing, whether the page a member actually receives has anything on
 * it. A suite can be entirely green while the site renders a blank page.
 *
 * So these are deliberately few and deliberately load-bearing. Each one fails
 * only if something is genuinely broken for a person, which is what keeps a
 * browser suite from becoming the thing everybody reruns until it passes.
 *
 * They need a built server and the demo data:
 *
 *   npm run db:migrate && npm run seed:demo
 *   npm run build && npm run start
 *   npm run test:browser
 */

const BASE = process.env.FM_BASE_URL ?? "http://127.0.0.1:3100";
const EXECUTABLE = process.env.CHROMIUM_PATH ?? undefined;

const DEMO_EMAIL = "deniz@demo.fiorematch.test";
const DEMO_PASSWORD = "demo-account-not-for-humans";

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ executablePath: EXECUTABLE });
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

/**
 * Anything the browser reported as broken while the page ran.
 *
 * `pageerror` is an uncaught exception — a hydration mismatch, a client
 * component throwing — and `console.error` is React complaining about something
 * it recovered from. Both are invisible to a server-side test and both mean the
 * page is not doing what it looks like it is doing.
 *
 * A subresource that 404s is *not* collected, and the distinction is easy to get
 * wrong: Chromium reports a failed image or font as a `console.error` too, with
 * the same type as a React warning. Left unfiltered, this helper flags a missing
 * favicon as a broken page — which is how a browser suite becomes the thing
 * everyone reruns until it goes green. Those messages are network facts and are
 * matched by their text, which is a fixed Chromium string.
 */
const RESOURCE_LOAD_FAILURE = /^Failed to load resource:/;

function collectFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`uncaught: ${error.message}`));
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (RESOURCE_LOAD_FAILURE.test(text)) return;
    failures.push(`console.error: ${text}`);
  });
  return failures;
}

async function newPage(): Promise<{ page: Page; failures: string[] }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  return { page, failures: collectFailures(page) };
}

/** Signs in through the form, the way a member does. */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${BASE}/tr/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", DEMO_EMAIL);
  await page.fill("#password", DEMO_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/tr\/app\//, { timeout: 20_000 }),
    page.click('button[type="submit"]')
  ]);
}

describe("the public site", () => {
  it("renders the Turkish home page without the browser reporting a fault", async () => {
    const { page, failures } = await newPage();

    const response = await page.goto(`${BASE}/tr`, { waitUntil: "networkidle" });

    expect(response?.status()).toBe(200);
    // Something rendered, rather than a shell that hydrated into nothing.
    expect((await page.locator("h1").first().innerText()).length).toBeGreaterThan(3);
    expect(failures).toEqual([]);
    await page.context().close();
  });

  /**
   * Twelve locales, and two of them are read right to left. The direction is
   * set from the locale on the server; if that regresses, every Arabic page is
   * laid out backwards and no server-side test notices, because the attribute
   * is correct in the markup either way — it is the rendering that is wrong.
   */
  it("lays out Arabic right to left", async () => {
    const { page } = await newPage();

    await page.goto(`${BASE}/ar`, { waitUntil: "domcontentloaded" });

    expect(await page.getAttribute("html", "dir")).toBe("rtl");
    expect(await page.getAttribute("html", "lang")).toBe("ar");
    await page.context().close();
  });
});

describe("getting into the app", () => {
  /**
   * The guard that matters most, checked the way an attacker would rather than
   * the way the code does: by asking for the page.
   */
  it("will not show Discover to someone signed out", async () => {
    const { page } = await newPage();

    await page.goto(`${BASE}/tr/app/discover`, { waitUntil: "domcontentloaded" });

    // Redirected away — not rendered with an empty feed.
    expect(page.url()).not.toContain("/app/discover");
    expect(page.url()).toMatch(/login/);
    await page.context().close();
  });

  it("signs a member in through the form and lands them in the app", async () => {
    const { page, failures } = await newPage();

    await signIn(page);

    expect(page.url()).toContain("/tr/app/");
    expect(failures).toEqual([]);
    await page.context().close();
  });
});

describe("the core loop", () => {
  /**
   * Discover end to end: the matching engine over real rows, the entitlement
   * check, the photo query, and the React that renders it. This is the one
   * screen whose breakage would make the product look empty rather than broken,
   * which is the kind of failure nobody reports.
   */
  it("shows Discover with people on it, and their photos actually load", async () => {
    const { page, failures } = await newPage();
    await signIn(page);

    /**
     * Every photo request the page made, with the status it got back.
     *
     * An `<img>` in the markup proves the server rendered a URL; it does not
     * prove there are bytes behind it. The two come apart whenever a row names
     * a file that was never written — which is precisely what the demo seed
     * used to do — and the page still looks structurally correct while showing
     * a grid of broken images.
     */
    const photoResponses: number[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/api/photos/")) photoResponses.push(response.status());
    });

    await page.goto(`${BASE}/tr/app/discover`, { waitUntil: "networkidle" });

    const images = page.locator('main img[src*="/api/photos/"]');
    await images.first().waitFor({ timeout: 20_000 });

    expect(await images.count()).toBeGreaterThan(0);
    expect(photoResponses.length).toBeGreaterThan(0);
    expect(photoResponses.filter((status) => status !== 200)).toEqual([]);
    expect(failures).toEqual([]);
    await page.context().close();
  });
});
