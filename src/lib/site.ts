export const siteUrl = process.env.SITE_URL ?? "https://fiorematch.com";
export const siteName = "FioreMatch";

/**
 * Whether the marketing site is served to the public.
 *
 * FioreMatch ships as a mobile app, and the deployment behind it exists to
 * serve that app rather than to be browsed. With this off the SEO tree — the
 * location pages, the guides, the feature pages — stops being reachable, the
 * crawlers are told to stay out, and the root becomes a page that points at
 * the stores.
 *
 * A switch rather than a deletion. Those pages are a real piece of work and
 * the decision not to publish them is a business one that can reverse; losing
 * the code to it would make reversing expensive. Off by default would be the
 * wrong default for anyone running this locally, so the site is public unless
 * a deployment says otherwise.
 *
 * What stays reachable either way: the legal pages, because Google Play
 * requires a publicly accessible privacy policy URL and refuses the listing
 * without one, and sign-in, because a deep link into the app may land there.
 */
export function publicSiteEnabled(): boolean {
  return process.env.PUBLIC_SITE !== "off";
}

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
