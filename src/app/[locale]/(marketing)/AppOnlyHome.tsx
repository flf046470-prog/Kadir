import { Link } from "@/i18n/navigation";

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
      <svg viewBox="0 0 28 28" className="h-14 w-14" aria-hidden="true">
        <defs>
          <linearGradient id="mark" x1="4.5" y1="4.5" x2="27.5" y2="24.5" gradientUnits="userSpaceOnUse">
            <stop stopColor="#fb6f92" />
            <stop offset="1" stopColor="#8360f5" />
          </linearGradient>
        </defs>
        <path
          fill="url(#mark)"
          d="M14 24.5s-9.5-5.86-9.5-13.02C4.5 7.4 7.55 4.5 11.1 4.5c1.99 0 3.7 1 4.9 2.62A6.02 6.02 0 0 1 20.9 4.5c3.55 0 6.6 2.9 6.6 6.98C27.5 18.64 18 24.5 14 24.5Z"
        />
      </svg>

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
