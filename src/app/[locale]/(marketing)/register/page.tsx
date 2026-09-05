import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buildMetadata } from "@/lib/seo";
import type { Locale } from "@/i18n/locales";
import { AuthForm } from "../AuthForm";
import { normalizeCode } from "@/lib/referral/codes";

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
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });

  // Normalised here so a code typed with confusable characters, or pasted with
  // stray spacing, is shown back in the form exactly as it will be stored.
  const raw = (await searchParams).ref;
  const referralCode = typeof raw === "string" ? (normalizeCode(raw) ?? undefined) : undefined;

  return (
    <section className="bg-aurora flex min-h-[calc(100vh-4rem)] items-center justify-center py-16">
      <div className="w-full max-w-md rounded-3xl border border-black/5 bg-white p-8 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-ink">{t("registerTitle")}</h1>
        <p className="mt-1 text-sm text-ink/60">{t("registerSubtitle")}</p>

        <AuthForm
          mode="register"
          locale={locale}
          referralCode={referralCode}
          labels={{
            name: t("nameLabel"),
            email: t("emailLabel"),
            password: t("passwordLabel"),
            birthdate: t("birthdateLabel"),
            country: t("countryLabel"),
            submit: t("registerButton"),
            termsAgree: t("termsAgree"),
            referredBy: t("referredBy")
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
