import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShareRow } from "@/components/share";
import { Prose } from "@/components/ui";
import { getPostBySlug, type PostKind } from "@/lib/content";
import { formatDate } from "@/lib/format";
import { getPageContext } from "@/lib/page";
import { absoluteUrl } from "@/lib/site";

/** Journal entries and updates are the same shape, so they share one renderer. */
export async function PostDetail({
  params,
  kind,
  basePath,
}: {
  params: Promise<{ locale: string; slug: string }>;
  kind: PostKind;
  basePath: string;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post || post.kind !== kind) notFound();

  const { t, settings, path } = await getPageContext(
    params as unknown as Promise<{ locale: string }>,
  );
  const url = absoluteUrl(`${path(basePath)}/${post.slug}`, settings);

  return (
    <article className="shell pt-28 pb-24 md:pt-40">
      <Link
        href={path(basePath)}
        className="label text-fog transition-colors hover:text-snow"
      >
        ← {t("cta.back")}
      </Link>

      <header className="mt-8 max-w-3xl">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <time dateTime={post.entry_date} className="label text-ember">
            {formatDate(post.entry_date)}
          </time>
          {post.phase_slug ? (
            <span className="label text-fog/60">· {post.phase_slug.replace(/-/g, " ")}</span>
          ) : null}
        </div>
        <h1 className="mt-5 font-display text-[2.4rem] leading-[1.05] md:text-6xl">{post.title}</h1>
        {post.excerpt ? (
          <p className="prose-valley mt-6 text-fog">{post.excerpt}</p>
        ) : null}
      </header>

      {post.image_path ? (
        <figure className="relative mt-12 aspect-[16/9] overflow-hidden rounded-sm bg-stone">
          <Image
            src={post.image_path}
            alt={post.image_alt || post.title}
            fill
            sizes="(max-width: 1024px) 100vw, 1000px"
            className="object-cover"
            priority
          />
        </figure>
      ) : null}

      {post.video_url ? (
        <div className="mt-12">
          <video
            src={post.video_url}
            controls
            playsInline
            preload="metadata"
            className="w-full rounded-sm bg-stone"
          />
        </div>
      ) : null}

      <div className="mt-12 max-w-2xl">
        <Prose body={post.body} />
      </div>

      <div className="mt-16 border-t border-fog/10 pt-8">
        <ShareRow
          url={url}
          text={post.title}
          labels={{
            title: t("share.title"),
            copy: t("share.copy"),
            copied: t("share.copied"),
            email: t("share.email"),
          }}
        />
      </div>
    </article>
  );
}
