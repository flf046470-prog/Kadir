import type { Metadata } from "next";
import { Reveal } from "@/components/reveal";
import { CtaLink, EmptyState, PageHeader, PostCard } from "@/components/ui";
import { getPosts } from "@/lib/content";
import { getPageContext } from "@/lib/page";
import { absoluteUrl } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { settings, path } = await getPageContext(params);
  const title = "Construction journal";
  const description =
    "The build diary for Patagonia Underground. It starts on the day the first phase of construction starts — not before.";
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path("/journal"), settings) },
    openGraph: { title, description, url: absoluteUrl(path("/journal"), settings) },
  };
}

export default async function JournalPage({ params }: { params: Promise<{ locale: string }> }) {
  const { t, path } = await getPageContext(params);
  const entries = getPosts("journal");

  return (
    <>
      <PageHeader
        kicker={t("nav.journal")}
        title="Construction journal"
        intro="Dated entries from the site itself: what was done, what it cost in time, and what went wrong."
      />

      <div className="shell py-20 md:py-28">
        {entries.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {entries.map((post, i) => (
              <Reveal key={post.id} delay={i * 60}>
                <PostCard post={post} basePath={path("/journal")} />
              </Reveal>
            ))}
          </div>
        ) : (
          <Reveal>
            <EmptyState
              headingLevel={2}
              title="The construction journal will begin when the first phase of the project starts."
              body="There is no site work to photograph and no progress to report, so there are no entries here. Nothing has been invented to fill the page."
              action={<CtaLink href={path("/join")}>{t("cta.keepPosted")}</CtaLink>}
            />
          </Reveal>
        )}
      </div>
    </>
  );
}
