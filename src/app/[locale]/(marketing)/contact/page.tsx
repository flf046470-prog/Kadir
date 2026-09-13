import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHero } from "@/components/PageHero";
import { buildMetadata } from "@/lib/seo";
import type { Locale } from "@/i18n/locales";
import { supportEmail } from "@/lib/site";
import { ContactForm } from "./ContactForm";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contact" });
  return buildMetadata({
    locale: locale as Locale,
    path: "/contact",
    title: t("title"),
    description: t("subtitle")
  });
}

export default async function ContactPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contact" });

  return (
    <>
      <PageHero eyebrow="Contact" title={t("title")} subtitle={t("subtitle")} />
      <section className="container-fm py-16">
        <p className="mb-6 max-w-xl text-sm text-bloom-700">{t("safetyUrgent")}</p>
        <ContactForm
          labels={{
            name: t("formName"),
            email: t("formEmail"),
            topic: t("formTopic"),
            topicOptions: t.raw("formTopicOptions") as string[],
            message: t("formMessage"),
            submit: t("formSubmit"),
            note: t("formNote"),
            opened: t("opened")
          }}
          supportEmail={supportEmail}
        />
      </section>
    </>
  );
}
