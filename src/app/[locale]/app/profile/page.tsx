import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth/guard";
import { loadMatchProfile } from "@/db/profile-repository";
import { ProfileForm } from "./ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const user = await currentUser();
  if (!user) redirect(`/${locale}/login`);

  const [t, profile] = await Promise.all([
    getTranslations({ locale, namespace: "app" }),
    loadMatchProfile(user.id)
  ]);

  return (
    <section className="container-fm max-w-2xl py-10">
      <h1 className="font-display text-3xl font-semibold text-ink">{t("profileTitle")}</h1>
      <p className="mt-2 text-ink/70">{t("profileIntro")}</p>

      <ProfileForm
        initial={{
          cityId: profile?.cityId ?? "",
          countryId: profile?.countryId ?? "",
          relationshipGoal: profile?.relationshipGoal ?? "unsure",
          interests: profile?.interests ?? [],
          languagesSpoken: profile?.languagesSpoken ?? []
        }}
        labels={{
          bio: t("bio"),
          interests: t("interests"),
          goal: t("goal"),
          city: t("city"),
          country: t("country"),
          languages: t("languages"),
          complete: t("complete"),
          save: t("save"),
          saved: t("saved"),
          logout: t("logout")
        }}
        locale={locale}
      />
    </section>
  );
}
