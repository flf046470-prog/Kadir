import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buildMetadata } from "@/lib/seo";
import type { Locale } from "@/i18n/locales";
import { AuthForm } from "../AuthForm";

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return buildMetadata({
    locale: locale as Locale,
    path: "/register",
    title: t("registerTitle"),
    description: t("registerSubtitle")
  });
}

export default async function RegisterPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });

  return (
    <section className="bg-aurora flex min-h-[calc(100vh-4rem)] items-center justify-center py-16">
      <div className="w-full max-w-md rounded-3xl border border-black/5 bg-white p-8 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-ink">{t("registerTitle")}</h1>
        <p className="mt-1 text-sm text-ink/60">{t("registerSubtitle")}</p>

        <AuthForm
          mode="register"
          labels={{
            name: t("nameLabel"),
            email: t("emailLabel"),
            password: t("passwordLabel"),
            birthdate: t("birthdateLabel"),
            submit: t("registerButton"),
            demoNotice: t("demoNotice"),
            termsAgree: t("termsAgree")
          }}
        />

        <div className="mt-6 text-sm">
          <Link href="/login" className="font-medium text-bloom-600 hover:underline">
            {t("haveAccount")} {t("logInLink")}
          </Link>
        </div>
      </div>
    </section>
  );
}
