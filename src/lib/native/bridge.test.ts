import { afterEach, describe, expect, it } from "vitest";
import { isNative, nativePlatform, routeForDeepLink } from "./bridge";

const HOSTS = ["fiorematch.com", "www.fiorematch.com"];

/**
 * These run in the `node` environment, where `window` genuinely does not
 * exist — which is exactly the server-rendering case the bridge has to
 * survive. A browser is simulated by installing the global, so both paths are
 * tested rather than one of them passing by accident.
 */
function asBrowser(capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string }) {
  (globalThis as { window?: unknown }).window = capacitor ? { Capacitor: capacitor } : {};
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("detection", () => {
  it("reports web while server-rendering, where there is no window at all", () => {
    expect(isNative()).toBe(false);
    expect(nativePlatform()).toBe("web");
  });

  it("reports web in a plain browser, where there is no Capacitor global", () => {
    asBrowser();
    expect(isNative()).toBe(false);
    expect(nativePlatform()).toBe("web");
  });

  it("reports the platform the shell claims", () => {
    asBrowser({ isNativePlatform: () => true, getPlatform: () => "ios" });
    expect(isNative()).toBe(true);
    expect(nativePlatform()).toBe("ios");
  });

  it("treats an unrecognised platform string as web rather than trusting it", () => {
    asBrowser({ isNativePlatform: () => true, getPlatform: () => "electron" });
    expect(nativePlatform()).toBe("web");
  });

  it("reports web when the shell is present but says it is not native", () => {
    // Capacitor's own web build injects the global too.
    asBrowser({ isNativePlatform: () => false, getPlatform: () => "web" });
    expect(isNative()).toBe(false);
  });
});

describe("deep links", () => {
  it("routes a referral link to the register page with its code", () => {
    expect(routeForDeepLink("https://fiorematch.com/tr/register?ref=ABCD2345", HOSTS)).toBe(
      "/tr/register?ref=ABCD2345"
    );
  });

  it("keeps the fragment, which a conversation anchor needs", () => {
    expect(routeForDeepLink("https://fiorematch.com/en/app/matches#latest", HOSTS)).toBe(
      "/en/app/matches#latest"
    );
  });

  it("accepts every host the shell is allowed to navigate", () => {
    expect(routeForDeepLink("https://www.fiorematch.com/en", HOSTS)).toBe("/en");
  });

  it("refuses another origin rather than rendering it inside our chrome", () => {
    // A webview has no address bar, so routing this in would show an attacker's
    // page wearing the app's frame.
    expect(routeForDeepLink("https://fiorematch.com.evil.example/en", HOSTS)).toBeNull();
    expect(routeForDeepLink("https://evil.example/en/app/discover", HOSTS)).toBeNull();
  });

  it("refuses a non-https scheme", () => {
    expect(routeForDeepLink("http://fiorematch.com/en", HOSTS)).toBeNull();
    expect(routeForDeepLink("javascript:alert(1)", HOSTS)).toBeNull();
    expect(routeForDeepLink("file:///etc/passwd", HOSTS)).toBeNull();
  });

  it("refuses something that is not a URL at all", () => {
    expect(routeForDeepLink("not a url", HOSTS)).toBeNull();
    expect(routeForDeepLink("", HOSTS)).toBeNull();
  });
});
