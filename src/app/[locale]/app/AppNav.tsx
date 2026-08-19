"use client";

import { useRouter } from "@/i18n/navigation";

export function AppNav({
  locale,
  displayName,
  labels
}: {
  locale: string;
  displayName: string;
  labels: { discover: string; profile: string; logout: string };
}) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="flex items-center gap-5 text-sm" aria-label="Account">
      <a href={`/${locale}/app/discover`} className="font-medium text-ink/70 hover:text-ink">
        {labels.discover}
      </a>
      <a href={`/${locale}/app/profile`} className="font-medium text-ink/70 hover:text-ink">
        {labels.profile}
      </a>
      <span className="hidden text-ink/40 sm:inline">{displayName}</span>
      <button type="button" onClick={handleLogout} className="text-ink/60 hover:text-ink">
        {labels.logout}
      </button>
    </nav>
  );
}
