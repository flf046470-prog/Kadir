/**
 * Known disposable-email providers.
 *
 * Deliberately a short, hand-checked list of the large throwaway services
 * rather than one of the 100k-entry lists that circulate. Those lists are
 * unmaintained, sweep up small legitimate hosts, and the cost of a false
 * positive here is a real member's reward silently held for review.
 *
 * This is one weak signal among several — a hit is worth 0.5 and never rejects
 * a referral on its own. Treat it as "worth a second look", not as a verdict.
 */
const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "20minutemail.com",
  "dispostable.com",
  "fakeinbox.com",
  "getairmail.com",
  "getnada.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "mailinator.com",
  "maildrop.cc",
  "mailnesia.com",
  "mintemail.com",
  "moakt.com",
  "mohmal.com",
  "sharklasers.com",
  "spam4.me",
  "temp-mail.org",
  "tempmail.com",
  "tempmailo.com",
  "throwawaymail.com",
  "trashmail.com",
  "yopmail.com",
  "yopmail.net"
]);

/**
 * Matches the domain and any subdomain of it, because these services hand out
 * per-user hosts (`sharklasers.com` also serves `mail.sharklasers.com`) and a
 * bare equality check misses them.
 */
export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at === -1) return false;

  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain) return false;

  if (DISPOSABLE_DOMAINS.has(domain)) return true;

  // Walk up the labels: mail.sharklasers.com → sharklasers.com → com.
  const labels = domain.split(".");
  for (let i = 1; i < labels.length - 1; i++) {
    if (DISPOSABLE_DOMAINS.has(labels.slice(i).join("."))) return true;
  }

  return false;
}
