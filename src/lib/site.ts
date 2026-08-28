export const siteUrl = "https://fiorematch.com";
export const siteName = "FioreMatch";

/**
 * Hosts a deep link may route into the app.
 *
 * Derived from `siteUrl` rather than written out again, so the allowlist
 * cannot drift from the canonical origin — a stale entry here is either a
 * referral link that silently stops opening the app, or a host we no longer
 * own being rendered inside our chrome.
 *
 * `www` is included because that is what people paste; it redirects on the
 * web, and the shell should follow rather than bounce out to a browser.
 */
export function allowedAppHosts(): string[] {
  const { hostname } = new URL(siteUrl);
  const bare = hostname.replace(/^www\./, "");
  return [bare, `www.${bare}`];
}
