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
  const title = "Project updates";
  const description =
    "Every published update from Patagonia Underground, newest first — each one dated and tied to a real phase of the project.";
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path("/updates"), settings) },
    openGraph: { title, description, url: absoluteUrl(path("/updates"), settings) },
  };
}

export default async function UpdatesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { t, path } = await getPageContext(params);
  const posts = getPosts("update");

  return (
    <>
      <PageHeader
        kicker={t("nav.updates")}
        title="Project updates"
        intro="Short posts about what has moved. If a month is quiet here, it was quiet on the project too."
      />

      <div className="shell py-20 md:py-28">
        {posts.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((post, i) => (
              <Reveal key={post.id} delay={i * 60}>
                <PostCard post={post} basePath={path("/updates")} />
              </Reveal>
            ))}
          </div>
        ) : (
          <Reveal>
            <EmptyState
              headingLevel={2}
              title="No updates published yet"
              body="The first update will be posted when there is something real to say. Until then this page stays empty on purpose."
              action={<CtaLink href={path("/join")}>{t("cta.keepPosted")}</CtaLink>}
            />
          </Reveal>
        )}
      </div>
    </>
  );
}
