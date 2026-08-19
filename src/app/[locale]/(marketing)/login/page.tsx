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
    path: "/login",
    title: t("loginTitle"),
    description: t("loginSubtitle")
  });
}

export default async function LoginPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });

  return (
    <section className="bg-aurora flex min-h-[calc(100vh-4rem)] items-center justify-center py-16">
      <div className="w-full max-w-md rounded-3xl border border-black/5 bg-white p-8 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-ink">{t("loginTitle")}</h1>
        <p className="mt-1 text-sm text-ink/60">{t("loginSubtitle")}</p>

        <AuthForm
          mode="login"
          locale={locale}
          labels={{
            email: t("emailLabel"),
            password: t("passwordLabel"),
            submit: t("loginButton")
          }}
        />

        <div className="mt-6 flex items-center justify-between text-sm">
          <Link href="/register" className="font-medium text-bloom-600 hover:underline">
            {t("noAccount")} {t("signUpLink")}
          </Link>
          <span className="text-ink/40">{t("forgotPassword")}</span>
        </div>
      </div>
    </section>
  );
}
