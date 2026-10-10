import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buildMetadata } from "@/lib/seo";
import type { Locale } from "@/i18n/locales";
import { verifyEmailToken } from "@/auth/email-verification";
import { ResendVerification } from "./ResendVerification";

/**
 * Where the link in the verification mail lands.
 *
 * Verifying on a GET rather than behind a form is a considered choice, not a
 * shortcut. The alternative is a page with a "confirm" button, which stops
 * link prefetchers from consuming the token — but it also adds a step to the
 * one flow where a member has already decided, and a surprising number of
 * people will not press a second button in a page they reached from an email.
 * `verifyEmailToken` is built for it: a replayed token answers "already
 * verified" rather than an error, so a mail client that fetched the link first
 * costs nothing.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });

  return {
    ...buildMetadata({
      locale: locale as Locale,
      path: "/verify-email",
      title: t("verifiedTitle"),
      description: t("verifiedBody")
    }),
    /**
     * Never indexed. The URL carries a one-time token; a crawler that reached
     * one would burn it, and a search result pointing here would be a dead
     * link for everybody who clicked it.
     */
    robots: { index: false, follow: false }
  };
}

export default async function VerifyEmailPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });

  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";

  // No token at all is its own case: somebody has reached this page without a
  // link, and telling them "invalid link" would imply theirs was broken.
  const outcome = token ? await verifyEmailToken(token) : null;

  const { title, body, offerResend } = describe(outcome, t);

  return (
    <section className="bg-aurora flex min-h-[calc(100vh-4rem)] items-center justify-center py-16">
      <div className="w-full max-w-md rounded-3xl border border-black/5 bg-white p-8 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-ink">{title}</h1>
        <p className="mt-3 text-ink/70">{body}</p>

        {offerResend ? (
          <ResendVerification
            labels={{
              button: t("verifyResendButton"),
              sending: t("verifyResendSending"),
              sent: t("verifyResendSent"),
              failed: t("verifyResendFailed"),
              rateLimited: t("verifyResendRateLimited"),
              signedOut: t("verifyResendSignedOut")
            }}
          />
        ) : (
          <Link
            href="/discover"
            className="mt-6 inline-block rounded-full bg-bloom-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-bloom-700"
          >
            {t("verifyContinue")}
          </Link>
        )}

        <p className="mt-6 text-sm text-ink/60">
          <Link href="/login" className="font-medium text-bloom-600 hover:underline">
            {t("logInLink")}
          </Link>
        </p>
      </div>
    </section>
  );
}

/**
 * Outcome to copy.
 *
 * Separated from the markup so each case is one line and the set is readable
 * as a whole — the thing that goes wrong with pages like this is a branch
 * nobody noticed was missing.
 */
function describe(
  outcome: Awaited<ReturnType<typeof verifyEmailToken>> | null,
  t: (key: string) => string
): { title: string; body: string; offerResend: boolean } {
  if (outcome === null) {
    return { title: t("verifyMissingTitle"), body: t("verifyMissingBody"), offerResend: true };
  }

  if (outcome.ok) {
    return outcome.alreadyVerified
      ? { title: t("verifyAlreadyTitle"), body: t("verifyAlreadyBody"), offerResend: false }
      : { title: t("verifiedTitle"), body: t("verifiedBody"), offerResend: false };
  }

  switch (outcome.reason) {
    case "expired":
      return { title: t("verifyExpiredTitle"), body: t("verifyExpiredBody"), offerResend: true };
    case "email_changed":
      return {
        title: t("verifyEmailChangedTitle"),
        body: t("verifyEmailChangedBody"),
        offerResend: true
      };
    case "unknown":
      return { title: t("verifyUnknownTitle"), body: t("verifyUnknownBody"), offerResend: true };
  }
}
