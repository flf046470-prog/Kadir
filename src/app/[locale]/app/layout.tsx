import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth/guard";
import { currentModerator } from "@/auth/moderator";
import { Logo } from "@/components/Logo";
import { AppNav } from "./AppNav";
import { MobileTabs } from "./MobileTabs";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";

/**
 * Shell for signed-in pages.
 *
 * The app section has its own layout so the marketing site stays statically
 * generated: reading the session cookie in the root layout would make all 400+
 * marketing routes dynamic, and those are the pages that need to be fast and
 * crawlable.
 */
export default async function AppLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const user = await currentUser();
  if (!user) redirect(`/${locale}/login`);

  // The link only renders for moderators; the page and API enforce it again.
  const moderator = await currentModerator();

  const t = await getTranslations({ locale, namespace: "app" });

  return (
    <div className="flex min-h-screen flex-col">
      {/*
        The padding is what keeps the header clear of the status bar. Both
        shells draw the page edge to edge — Android 15 forces it and ignores a
        window inset, and the iOS config sets `contentInset: "never"` on
        purpose — so without this the clock sits on top of the logo. The white
        stays behind the bar because the padding is inside the header.
      */}
      <header
        className="border-b border-black/5 bg-white"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="container-fm flex h-16 items-center justify-between gap-4">
          <a href={`/${locale}/app/discover`}>
            <Logo />
          </a>
          <AppNav
            locale={locale}
            displayName={user.displayName}
            isModerator={moderator !== null}
            labels={{
              dailyFive: t("dailyFiveNav"),
              discover: t("discoverTitle"),
              matches: t("matchesTitle"),
              referral: t("referralNav"),
              profile: t("profileTitle"),
              moderation: t("moderationTitle"),
              logout: t("logout")
            }}
          />
        </div>
      </header>
      {/* The padding clears the fixed bottom tabs, which are phone-only. */}
      <main className="flex-1 pb-20 sm:pb-0">{children}</main>

      <MobileTabs
        locale={locale}
        labels={{
          dailyFive: t("dailyFiveNav"),
          discover: t("discoverTitle"),
          matches: t("matchesTitle"),
          referral: t("referralNav"),
          profile: t("profileTitle")
        }}
      />

      <InstallPrompt
        labels={{
          pitch: t("installPitch"),
          install: t("install"),
          dismiss: t("installDismiss")
        }}
      />
    </div>
  );
}
