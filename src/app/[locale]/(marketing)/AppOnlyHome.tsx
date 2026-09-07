import { Link } from "@/i18n/navigation";
import { BrandMark } from "@/components/BrandMark";

/**
 * What the bare domain shows when the marketing site is switched off.
 *
 * A 404 on the root would be the wrong answer for the one page that is
 * guaranteed to be visited: store reviewers open it, and so does anyone who
 * reads the domain off the listing. So the root stays a page — it just stops
 * being a marketing page and becomes a pointer to the app, plus the two legal
 * links Play and Apple require to be reachable without an install.
 *
 * Deliberately not a landing page in disguise. No feature copy, no signup
 * funnel, nothing to crawl. The decision here was that the product lives in
 * the stores; this page honours that rather than quietly reinstating a site.
 */
export function AppOnlyHome({
  labels
}: {
  labels: {
    tagline: string;
    body: string;
    privacy: string;
    terms: string;
    signIn: string;
  };
}) {
  return (
    <section className="container-fm flex min-h-[70vh] max-w-lg flex-col items-center justify-center py-20 text-center">
      <BrandMark gradientId="fm-apponly-grad" className="h-14 w-14" />

      <h1 className="mt-6 font-display text-3xl font-semibold text-ink">FioreMatch</h1>
      <p className="mt-2 text-lg text-ink/70">{labels.tagline}</p>
      <p className="mt-6 max-w-prose text-ink/60">{labels.body}</p>

      <Link href="/login" className="btn-primary mt-8">
        {labels.signIn}
      </Link>

      <nav className="mt-10 flex gap-6 text-sm text-ink/50">
        <Link href="/legal/privacy" className="hover:text-ink">
          {labels.privacy}
        </Link>
        <Link href="/legal/terms" className="hover:text-ink">
          {labels.terms}
        </Link>
      </nav>
    </section>
  );
}
