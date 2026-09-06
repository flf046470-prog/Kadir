import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { signupsOpen } from "@/lib/site";

/**
 * Every "join FioreMatch" call to action, in one component.
 *
 * The point is the closed case. `SIGNUPS=closed` lets the marketing site
 * publish and be indexed before registration opens, but the site is a funnel —
 * ten links across eight pages, the header button and the hero among them, all
 * saying "join free". Gating the *form* and leaving the invitations promising
 * something the next page refuses is how a deliberate soft launch comes across
 * as a broken one.
 *
 * The link is kept rather than hidden, and only the label changes. Somebody who
 * clicks deserves the explanation on `/register` — "we are finishing the safety
 * checks every photo goes through" is a better thing to read than a CTA that
 * quietly vanished, and it is a reason to come back. Keeping the link also
 * means the pages being indexed now are the ones that will work when it opens:
 * nothing about the page shape changes on the day the switch flips.
 *
 * A server component because `signupsOpen()` reads the environment, which the
 * client has no business knowing before it needs to.
 */
export async function JoinLink({
  label,
  className = "btn-primary"
}: {
  /** What it says when registration is open. Each page has its own wording. */
  label: string;
  className?: string;
}) {
  const t = await getTranslations("auth");

  return (
    <Link href="/register" className={className}>
      {signupsOpen() ? label : t("signupsClosedCta")}
    </Link>
  );
}
