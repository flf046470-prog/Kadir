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
    path: "/legal/community-guidelines",
    title: "Community Guidelines",
    description: "What we expect from every FioreMatch member, and how reports are handled."
  });
}

export default function CommunityGuidelinesPage() {
  return (
    <LegalPage
      title="Community Guidelines"
      updated="August 2026"
      intro="Real people, treated with respect. Here's what that means in practice."
    >
      <LegalSection heading="Be who you say you are">
        <p>Use recent, real photos of yourself and accurate profile information. No catfishing, no fake ages, no impersonation.</p>
      </LegalSection>
      <LegalSection heading="No harassment, hate, or threats">
        <p>Zero tolerance for harassment, hate speech, discrimination, or threats of violence, whether in profiles, messages, or reports themselves.</p>
      </LegalSection>
      <LegalSection heading="No solicitation or scams">
        <p>No requests for money, gift cards, crypto, or financial information. No promoting other services, sex work solicitation, or off-platform financial schemes.</p>
      </LegalSection>
      <LegalSection heading="No sexual content involving minors, ever">
        <p>This is reported to relevant authorities and results in immediate, permanent removal — no exceptions, no appeal.</p>
      </LegalSection>
      <LegalSection heading="How enforcement works">
        <p>
          Automated systems flag likely violations (spam patterns, fraud signals, abuse
          reports). Serious or ambiguous cases are routed to a human-reviewed moderation queue
          before enforcement action is taken — AI flags risk, people make the final call.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
