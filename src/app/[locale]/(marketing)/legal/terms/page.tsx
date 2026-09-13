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
    path: "/legal/terms",
    title: "Terms of Service",
    description: "The terms that govern your use of FioreMatch."
  });
}

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="August 2026"
      intro="The rules for using FioreMatch, in plain language."
    >
      <LegalSection heading="1. Eligibility">
        <p>You must be at least 18 years old to create a FioreMatch account.</p>
      </LegalSection>
      <LegalSection heading="2. Your account">
        <p>
          You are responsible for keeping your login credentials secure and for the accuracy of
          your profile. Impersonation, fake accounts, and misrepresenting your identity are
          prohibited.
        </p>
      </LegalSection>
      <LegalSection heading="3. Acceptable use">
        <p>
          No harassment, hate speech, solicitation, fraud, spam, or requests for money or
          financial information from other members. Violations may lead to warnings, suspension,
          or permanent removal, reviewed per our Community Guidelines.
        </p>
      </LegalSection>
      <LegalSection heading="4. Subscriptions and purchases">
        <p>
          PLUS, VIP, and one-time purchases (Boost, Super Like, Profile Promotion, Premium
          Visibility) are billed through the Apple App Store, Google Play, or our web payment
          provider, and are subject to their respective refund policies. Entitlements are
          verified server-side before premium access is granted.
        </p>
      </LegalSection>
      <LegalSection heading="5. Termination">
        <p>
          You may delete your account at any time. We may suspend or terminate accounts that
          violate these terms, applicable law, or that pose a safety risk to other members.
        </p>
      </LegalSection>
      <LegalSection heading="6. Disclaimers">
        <p>
          FioreMatch helps people connect but cannot guarantee the identity, intentions, or
          safety of any member. Use the safety practices described in our Safety Center.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
