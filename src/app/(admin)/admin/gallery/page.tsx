import Image from "next/image";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getGalleryImages } from "@/lib/content";
import { deleteImageAction, saveImageAction } from "../actions";
import { SaveForm } from "../save-form";
import { AdminShell, Panel, inputClass } from "../ui";

export const dynamic = "force-dynamic";

type Search = Promise<{ edit?: string }>;

export default async function AdminGalleryPage({ searchParams }: { searchParams: Search }) {
  const admin = await requireAdmin();
  const { edit } = await searchParams;
  const images = getGalleryImages(undefined, true);
  const editing = edit ? images.find((i) => String(i.id) === edit) : undefined;

  return (
    <AdminShell
      title="Gallery"
      intro="Alt text and licence are required. An image whose licence you cannot name does not belong on the site."
      email={admin.email}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Panel title={`Images (${images.length})`}>
          {images.length === 0 ? (
            <p className="text-sm text-fog">
              Nothing uploaded. Both public gallery sections show an honest empty state until an
              image exists.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3">
              {images.map((image) => (
                <li key={image.id} className="card-stone overflow-hidden">
                  <Link href={`/admin/gallery?edit=${image.id}`} className="block">
                    <div className="relative aspect-[4/3] bg-basalt">
                      <Image
                        src={image.file_path}
                        alt={image.alt_text}
                        fill
                        sizes="200px"
                        className="object-cover"
                      />
                    </div>
                    <p className="truncate px-3 py-2 text-xs text-mist">
                      {image.title || image.file_path}
                    </p>
                  </Link>
                  <form action={deleteImageAction} className="border-t border-fog/10 px-3 py-2">
                    <input type="hidden" name="id" value={image.id} />
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
        </Panel>

        <Panel title={editing ? "Edit image" : "Add an image"}>
          <SaveForm action={saveImageAction} encType="multipart/form-data">
            <input type="hidden" name="id" value={editing?.id ?? ""} />
            <input type="hidden" name="file_path" value={editing?.file_path ?? ""} />

            <div>
              <label htmlFor="image" className="label mb-2 block">
                File {editing ? "— leave empty to keep the current image" : ""}
              </label>
              <input
                id="image"
                name="image"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                className="w-full text-xs text-fog file:mr-3 file:rounded-full file:border-0 file:bg-stone file:px-4 file:py-2 file:text-xs file:text-snow"
              />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="category" className="label mb-2 block">
                  Section
                </label>
                <select
                  id="category"
                  name="category"
                  defaultValue={editing?.category ?? "patagonia"}
                  className={inputClass}
                >
                  <option value="patagonia">Patagonia — the region</option>
                  <option value="project">Project — land, drawings, build</option>
                </select>
              </div>
              <div>
                <label htmlFor="season" className="label mb-2 block">
                  Season
                </label>
                <select
                  id="season"
                  name="season"
                  defaultValue={editing?.season ?? ""}
                  className={inputClass}
                >
                  <option value="">—</option>
                  <option value="summer">Summer</option>
                  <option value="autumn">Autumn</option>
                  <option value="winter">Winter</option>
                  <option value="spring">Spring</option>
                </select>
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="subject" className="label mb-2 block">
                What it shows
              </label>
              <input
                id="subject"
                name="subject"
                list="gallery-subjects"
                placeholder="Exterior — night"
                defaultValue={editing?.subject ?? ""}
                className={inputClass}
              />
              <datalist id="gallery-subjects">
                <option value="Exterior — night" />
                <option value="Exterior — landscape" />
                <option value="Living room" />
                <option value="Dining area" />
                <option value="Bedroom" />
                <option value="Bathroom" />
                <option value="Floor plan" />
                <option value="Site plan" />
                <option value="Section" />
                <option value="Interface" />
              </datalist>
              <p className="mt-2 text-xs text-fog/60">
                The label the gallery shows above the caption. Say what the image is — a render is
                a render, a drawing is a drawing.
              </p>
            </div>

            <div className="mt-4">
              <label htmlFor="title" className="label mb-2 block">
                Title
              </label>
              <input
                id="title"
                name="title"
                defaultValue={editing?.title ?? ""}
                className={inputClass}
              />
            </div>

            <div className="mt-4">
              <label htmlFor="alt_text" className="label mb-2 block">
                Alt text — required
              </label>
              <input
                id="alt_text"
                name="alt_text"
                required
                defaultValue={editing?.alt_text ?? ""}
                className={inputClass}
              />
            </div>

            <div className="mt-4">
              <label htmlFor="description" className="label mb-2 block">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                rows={3}
                defaultValue={editing?.description ?? ""}
                className={`${inputClass} resize-y`}
              />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="location" className="label mb-2 block">
                  Location
                </label>
                <input
                  id="location"
                  name="location"
                  defaultValue={editing?.location ?? ""}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="photographer" className="label mb-2 block">
                  Photographer
                </label>
                <input
                  id="photographer"
                  name="photographer"
                  defaultValue={editing?.photographer ?? ""}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="license" className="label mb-2 block">
                  Licence — required
                </label>
                <input
                  id="license"
                  name="license"
                  required
                  placeholder="CC BY 4.0 / own photograph / licensed stock"
                  defaultValue={editing?.license ?? ""}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="source_url" className="label mb-2 block">
                  Source URL
                </label>
                <input
                  id="source_url"
                  name="source_url"
                  defaultValue={editing?.source_url ?? ""}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-6">
              <div>
                <label htmlFor="sort_order" className="label mb-2 block">
                  Order
                </label>
                <input
                  id="sort_order"
                  name="sort_order"
                  type="number"
                  defaultValue={editing?.sort_order ?? 0}
                  className={`${inputClass} w-24`}
                />
              </div>
              <label className="flex items-center gap-2 pt-6 text-sm text-fog">
                <input
                  type="checkbox"
                  name="published"
                  defaultChecked={editing ? Boolean(editing.published) : true}
                  className="h-4 w-4 accent-[#c0603a]"
                />
                Published
              </label>
            </div>
          </SaveForm>
        </Panel>
      </div>
    </AdminShell>
  );
}
