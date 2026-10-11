import { siteName, supportEmail } from "@/lib/site";
import type { MailMessage } from "./mail";

/**
 * Mail bodies.
 *
 * Written here rather than in the next-intl message catalogue on purpose. The
 * catalogue is loaded by a React provider for a request that has a locale;
 * this runs in a route handler, and sometimes in a job, where there is no such
 * request. Pulling the i18n runtime into that path to fetch two strings would
 * couple sending mail to rendering a page.
 *
 * Turkish and English only, matching the two catalogues that actually exist —
 * `src/i18n/messages/` has `tr.json` and `en.json`, and the other advertised
 * locales fall back to English there too. A member whose locale we cannot
 * write gets English rather than a template literal with a missing value in
 * it.
 */

type Copy = {
  subject: string;
  greeting: (name: string) => string;
  lead: string;
  action: string;
  expiry: (hours: number) => string;
  ignore: string;
  help: (address: string) => string;
};

const COPY: Record<"tr" | "en", Copy> = {
  tr: {
    subject: `${siteName} hesabını doğrula`,
    greeting: (name) => `Merhaba ${name},`,
    lead: `${siteName} hesabın oluşturuldu. Başlamak için e-posta adresinin sana ait olduğunu doğrula.`,
    action: "E-posta adresimi doğrula",
    expiry: (hours) => `Bu bağlantı ${hours} saat geçerlidir.`,
    ignore:
      "Bu hesabı sen oluşturmadıysan bu e-postayı yok sayabilirsin — doğrulanmayan hesaplar kullanılamaz.",
    help: (address) => `Bir sorun olursa bize ${address} adresinden yazabilirsin.`
  },
  en: {
    subject: `Verify your ${siteName} account`,
    greeting: (name) => `Hello ${name},`,
    lead: `Your ${siteName} account has been created. Confirm that this email address is yours to get started.`,
    action: "Verify my email address",
    expiry: (hours) => `This link is valid for ${hours} hours.`,
    ignore:
      "If you did not create this account you can ignore this email — an unverified account cannot be used.",
    help: (address) => `If something goes wrong, write to us at ${address}.`
  }
};

function copyFor(locale: string | undefined): Copy {
  return locale?.toLowerCase().startsWith("tr") ? COPY.tr : COPY.en;
}

/**
 * HTML escaping for the values we interpolate.
 *
 * `displayName` is member-supplied and goes into the HTML part. Without this, a
 * name containing a tag would be rendered as markup by the recipient's mail
 * client — which is their own name in their own mail, so not much of an attack
 * on them, but the same template is used for any address a member can enter,
 * and "member-supplied string concatenated into markup" is not a thing to
 * leave unescaped and reason about case by case.
 *
 * The link is escaped too. It is ours, but it carries a token, and a token is
 * base64url — which has no HTML-significant characters, so escaping it is a
 * no-op today and a guard if the format ever changes.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function verifyEmailMessage(input: {
  to: string;
  displayName: string;
  link: string;
  locale?: string;
  expiresInHours: number;
}): MailMessage {
  const copy = copyFor(input.locale);
  const name = input.displayName.trim() || input.to;

  /**
   * The text part carries the URL in full, on its own line.
   *
   * It is not a fallback nobody reads: plenty of clients strip the HTML part,
   * corporate gateways rewrite links, and a member who distrusts a button in
   * an email is behaving correctly. The raw URL has to be there to copy.
   */
  const text = [
    copy.greeting(name),
    "",
    copy.lead,
    "",
    input.link,
    "",
    copy.expiry(input.expiresInHours),
    copy.ignore,
    "",
    copy.help(supportEmail),
    siteName
  ].join("\n");

  const html = [
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:16px;line-height:1.6;color:#2b2430;max-width:34em">`,
    `<p>${escapeHtml(copy.greeting(name))}</p>`,
    `<p>${escapeHtml(copy.lead)}</p>`,
    `<p><a href="${escapeHtml(input.link)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#fb6f92;color:#fff;text-decoration:none;font-weight:600">${escapeHtml(copy.action)}</a></p>`,
    // Repeated as text beneath the button, for the clients that drop anchors.
    `<p style="font-size:13px;color:#6c6370;word-break:break-all">${escapeHtml(input.link)}</p>`,
    `<p style="font-size:13px;color:#6c6370">${escapeHtml(copy.expiry(input.expiresInHours))}<br>${escapeHtml(copy.ignore)}</p>`,
    `<p style="font-size:13px;color:#6c6370">${escapeHtml(copy.help(supportEmail))}<br>${escapeHtml(siteName)}</p>`,
    `</div>`
  ].join("");

  return { to: input.to, subject: copy.subject, text, html };
}
