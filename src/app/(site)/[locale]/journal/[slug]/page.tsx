import type { Metadata } from "next";
import { PostDetail } from "../../post-detail";
import { getPostBySlug } from "@/lib/content";
import { getSiteConfig } from "@/lib/site";

type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  getSiteConfig();
  if (!post) return { title: "Journal entry" };
  return {
    title: post.title,
    description: post.excerpt || undefined,
    openGraph: { title: post.title, description: post.excerpt || undefined, type: "article" },
  };
}

export default function JournalEntryPage({ params }: { params: Params }) {
  return <PostDetail params={params} kind="journal" basePath="/journal" />;
}
