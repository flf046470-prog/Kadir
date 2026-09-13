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
    path: "/legal/privacy",
    title: "Privacy Policy",
    description: "How FioreMatch collects, uses, and protects your personal data, in line with GDPR, KVKK, and global privacy standards."
  });
}

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="August 2026"
      intro="What we collect, why we collect it, and the controls you have over your data."
    >
      <LegalSection heading="1. Data we collect">
        <p>
          Account data (email or phone, password hash, date of birth), profile data you choose
          to add (photos, bio, interests, relationship intent, languages), usage data (likes,
          passes, matches, messages, reports), and device/technical data needed to operate the
          service securely.
        </p>
      </LegalSection>
      <LegalSection heading="2. Why we process it">
        <p>
          To operate matching and messaging, to keep the platform safe (fraud, spam, and abuse
          detection), to provide PLUS/VIP entitlements you purchase, to comply with legal
          obligations, and — only with a lawful basis — to improve the product.
        </p>
      </LegalSection>
      <LegalSection heading="3. Your rights">
        <p>
          Depending on your location, you may have rights to access, correct, export, or delete
          your data, and to object to or restrict certain processing (GDPR Articles 15–21, KVKK
          Article 11, and equivalent rights elsewhere). You can delete your account entirely,
          at any time, from account settings.
        </p>
      </LegalSection>
      <LegalSection heading="4. Data sharing">
        <p>
          We do not sell your personal data. We share data with service providers strictly
          necessary to run the platform (hosting, payment processors, moderation tooling) under
          data processing agreements, and with law enforcement only where legally required.
        </p>
      </LegalSection>
      <LegalSection heading="5. International transfers">
        <p>
          As a global platform, data may be processed in countries other than your own. Where
          required, we rely on recognized transfer mechanisms such as Standard Contractual
          Clauses.
        </p>
      </LegalSection>
      <LegalSection heading="6. Contact">
        <p>Questions about this policy can be sent through our Contact page.</p>
      </LegalSection>
    </LegalPage>
  );
}
