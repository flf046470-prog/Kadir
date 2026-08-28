"use client";

import { useRouter } from "@/i18n/navigation";

export function AppNav({
  locale,
  displayName,
  isModerator = false,
  labels
}: {
  locale: string;
  displayName: string;
  isModerator?: boolean;
  labels: {
    dailyFive: string;
    discover: string;
    matches: string;
    referral: string;
    profile: string;
    moderation: string;
    logout: string;
  };
}) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  /**
   * Below `sm` the destinations live in the bottom tab bar instead, so they are
   * hidden here rather than rendered twice: six links, a name and a logout
   * button in one row overflow a 412px screen by about 150px, which is a page
   * that scrolls sideways and a tab bar that cannot be tapped reliably.
   *
   * What stays on a phone is what the tabs do not carry — who you are signed in
   * as, the way out, and the moderation console for the few accounts that have
   * it.
   */
  const destination = "hidden font-medium text-ink/70 hover:text-ink sm:inline";

  return (
    <nav className="flex items-center gap-5 text-sm" aria-label="Account">
      <a href={`/${locale}/app/daily-five`} className={destination}>
        {labels.dailyFive}
      </a>
      <a href={`/${locale}/app/discover`} className={destination}>
        {labels.discover}
      </a>
      <a href={`/${locale}/app/matches`} className={destination}>
        {labels.matches}
      </a>
      <a href={`/${locale}/app/referral`} className={destination}>
        {labels.referral}
      </a>
      <a href={`/${locale}/app/profile`} className={destination}>
        {labels.profile}
      </a>
      {isModerator && (
        <a
          href={`/${locale}/app/moderation`}
          className="hidden font-medium text-bloom-600 hover:text-bloom-700 sm:inline"
        >
          {labels.moderation}
        </a>
      )}
      <span className="hidden text-ink/40 sm:inline">{displayName}</span>
      <button type="button" onClick={handleLogout} className="text-ink/60 hover:text-ink">
        {labels.logout}
      </button>
    </nav>
  );
}
