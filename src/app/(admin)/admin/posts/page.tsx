import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getPhases, getPosts } from "@/lib/content";
import { formatDate } from "@/lib/format";
import { deletePostAction, savePostAction } from "../actions";
import { SaveForm } from "../save-form";
import { AdminShell, Panel, inputClass } from "../ui";

export const dynamic = "force-dynamic";

type Search = Promise<{ edit?: string }>;

export default async function AdminPostsPage({ searchParams }: { searchParams: Search }) {
  const admin = await requireAdmin();
  const { edit } = await searchParams;

  const posts = getPosts("all", { includeDrafts: true });
  const phases = getPhases();
  const editing = edit ? posts.find((p) => String(p.id) === edit) : undefined;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <AdminShell
      title="Journal & updates"
      intro="Journal entries are the build diary; updates are the shorter posts. Both stay invisible on the site until you tick Published."
      email={admin.email}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Panel title={`Entries (${posts.length})`}>
          {posts.length === 0 ? (
            <p className="text-sm text-fog">Nothing written yet.</p>
          ) : (
            <ul className="divide-y divide-fog/10">
              {posts.map((post) => (
                <li key={post.id} className="flex items-baseline justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/posts?edit=${post.id}`}
                      className="block truncate text-sm text-snow hover:text-ember"
                    >
                      {post.title}
                    </Link>
                    <p className="mt-1 text-xs text-fog/60">
                      {formatDate(post.entry_date)} · {post.kind}
                      {post.published ? "" : " · draft"}
                    </p>
                  </div>
                  <form action={deletePostAction}>
                    <input type="hidden" name="id" value={post.id} />
                    <button
                      type="submit"
                      className="text-xs text-fog/60 transition-colors hover:text-tulip"
                    >
                      Delete
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          {editing ? (
            <Link href="/admin/posts" className="mt-5 inline-block text-xs text-ember">
              + Write a new entry instead
            </Link>
          ) : null}
        </Panel>

        <Panel title={editing ? `Editing: ${editing.title}` : "New entry"}>
          <SaveForm action={savePostAction} encType="multipart/form-data">
            <input type="hidden" name="id" value={editing?.id ?? ""} />
            <input type="hidden" name="image_path" value={editing?.image_path ?? ""} />

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="kind" className="label mb-2 block">
                  Type
                </label>
                <select
                  id="kind"
                  name="kind"
                  defaultValue={editing?.kind ?? "update"}
                  className={inputClass}
                >
                  <option value="update">Update</option>
                  <option value="journal">Journal</option>
                </select>
              </div>
              <div>
                <label htmlFor="entry_date" className="label mb-2 block">
                  Date
                </label>
                <input
                  id="entry_date"
                  name="entry_date"
                  type="date"
                  required
                  defaultValue={editing?.entry_date ?? today}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="phase_slug" className="label mb-2 block">
                  Phase
                </label>
                <select
                  id="phase_slug"
                  name="phase_slug"
                  defaultValue={editing?.phase_slug ?? ""}
                  className={inputClass}
                >
                  <option value="">—</option>
                  {phases.map((phase) => (
                    <option key={phase.slug} value={phase.slug}>
                      {phase.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="title" className="label mb-2 block">
                Title
              </label>
              <input
                id="title"
                name="title"
                required
                defaultValue={editing?.title ?? ""}
                className={inputClass}
              />
            </div>

            <div className="mt-4">
              <label htmlFor="slug" className="label mb-2 block">
                Slug — leave blank to generate from the title
              </label>
              <input
                id="slug"
                name="slug"
                defaultValue={editing?.slug ?? ""}
                className={inputClass}
              />
            </div>

            <div className="mt-4">
              <label htmlFor="excerpt" className="label mb-2 block">
                Excerpt
              </label>
              <textarea
                id="excerpt"
                name="excerpt"
                rows={2}
                defaultValue={editing?.excerpt ?? ""}
                className={`${inputClass} resize-y`}
              />
            </div>

            <div className="mt-4">
              <label htmlFor="body" className="label mb-2 block">
                Body — blank line between paragraphs
              </label>
              <textarea
                id="body"
                name="body"
                rows={10}
                defaultValue={editing?.body ?? ""}
                className={`${inputClass} resize-y`}
              />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="image" className="label mb-2 block">
                  Photograph
                </label>
                <input
                  id="image"
                  name="image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  className="w-full text-xs text-fog file:mr-3 file:rounded-full file:border-0 file:bg-stone file:px-4 file:py-2 file:text-xs file:text-snow"
                />
                {editing?.image_path ? (
                  <p className="mt-2 truncate text-xs text-fog/60">{editing.image_path}</p>
                ) : null}
              </div>
              <div>
                <label htmlFor="image_alt" className="label mb-2 block">
                  Image alt text
                </label>
                <input
                  id="image_alt"
                  name="image_alt"
                  defaultValue={editing?.image_alt ?? ""}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="video_url" className="label mb-2 block">
                Video URL — an https link, or a path under /uploads
              </label>
              <input
                id="video_url"
                name="video_url"
                defaultValue={editing?.video_url ?? ""}
                className={inputClass}
              />
            </div>

            <label className="mt-5 flex items-center gap-2 text-sm text-fog">
              <input
                type="checkbox"
                name="published"
                defaultChecked={Boolean(editing?.published)}
                className="h-4 w-4 accent-[#c0603a]"
              />
              Published — visible on the public site
            </label>
          </SaveForm>
        </Panel>
      </div>
    </AdminShell>
  );
}
