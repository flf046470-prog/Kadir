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

  return (
    <nav className="flex items-center gap-5 text-sm" aria-label="Account">
      <a href={`/${locale}/app/daily-five`} className="font-medium text-ink/70 hover:text-ink">
        {labels.dailyFive}
      </a>
      <a href={`/${locale}/app/discover`} className="font-medium text-ink/70 hover:text-ink">
        {labels.discover}
      </a>
      <a href={`/${locale}/app/matches`} className="font-medium text-ink/70 hover:text-ink">
        {labels.matches}
      </a>
      <a href={`/${locale}/app/referral`} className="font-medium text-ink/70 hover:text-ink">
        {labels.referral}
      </a>
      <a href={`/${locale}/app/profile`} className="font-medium text-ink/70 hover:text-ink">
        {labels.profile}
      </a>
      {isModerator && (
        <a
          href={`/${locale}/app/moderation`}
          className="font-medium text-bloom-600 hover:text-bloom-700"
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
