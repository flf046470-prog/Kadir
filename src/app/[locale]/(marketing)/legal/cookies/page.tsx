import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import type { Locale } from "@/i18n/locales";
import { LegalPage, LegalSection } from "@/components/LegalPage";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildMetadata({
    locale: locale as Locale,
    path: "/legal/cookies",
    title: "Cookie Policy",
    description: "How FioreMatch uses cookies and similar technologies."
  });
}

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      updated="August 2026"
      intro="What cookies we use, and the choices you have."
    >
      <LegalSection heading="Essential cookies">
        <p>Required to keep you logged in, remember your language preference, and keep the platform secure. These cannot be turned off.</p>
      </LegalSection>
      <LegalSection heading="Analytics cookies">
        <p>Help us understand product usage in aggregate — matches, retention, feature adoption — so we can improve FioreMatch. Optional, and off by default until consented where required by law.</p>
      </LegalSection>
      <LegalSection heading="Your choices">
        <p>
          Where legally required, we ask for consent before setting non-essential cookies, and you
          can withdraw consent at any time from your account preferences.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
