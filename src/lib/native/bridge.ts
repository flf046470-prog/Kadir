/**
 * Talking to the native shell, without making the website pay for it.
 *
 * The detection here deliberately does **not** import `@capacitor/core`.
 * Capacitor injects a `window.Capacitor` global into the webview before any
 * application code runs, so a property check answers the question for free —
 * whereas importing the package would pull Capacitor into the bundle every
 * browser visitor downloads, to answer "no" for all of them.
 *
 * Everything past the check is dynamically imported inside the native branch,
 * so the plugins are fetched only where they can actually do something. That
 * is also why every function here is safe to call on the server and in a plain
 * browser: they return early rather than throwing.
 */

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
  }
}

export type NativePlatform = "ios" | "android" | "web";

/** True only inside the Capacitor shell. False during SSR and in a browser. */
export function isNative(): boolean {
  if (typeof window === "undefined") return false;
  return window.Capacitor?.isNativePlatform?.() === true;
}

export function nativePlatform(): NativePlatform {
  if (typeof window === "undefined") return "web";
  const platform = window.Capacitor?.getPlatform?.();
  return platform === "ios" || platform === "android" ? platform : "web";
}

/**
 * Turns a deep link into an in-app route.
 *
 * Returns the path to navigate to, or null when the URL is not ours. A link to
 * somewhere else must never be routed *into* the app: doing so would render an
 * arbitrary destination inside our chrome, with our address-bar-less webview,
 * which is the shape of a phishing page.
 */
export function routeForDeepLink(rawUrl: string, allowedHosts: string[]): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (!allowedHosts.includes(url.hostname)) return null;

  return `${url.pathname}${url.search}${url.hash}`;
}
