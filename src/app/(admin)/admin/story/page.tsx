import { requireAdmin } from "@/lib/auth";
import { getStorySections } from "@/lib/content";
import { saveStoryAction } from "../actions";
import { SaveForm } from "../save-form";
import { AdminShell, Panel, inputClass } from "../ui";

export const dynamic = "force-dynamic";

export default async function AdminStoryPage() {
  const admin = await requireAdmin();
  const sections = getStorySections(true);

  return (
    <AdminShell
      title="Story"
      intro="The five chapters on /story. The first two also appear on the home page."
      email={admin.email}
    >
      <div className="grid gap-6">
        {sections.map((section) => (
          <Panel key={section.id} title={section.heading} meta={section.slug}>
            <SaveForm action={saveStoryAction}>
              <input type="hidden" name="id" value={section.id} />
              <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
                <div>
                  <label htmlFor={`kicker-${section.id}`} className="label mb-2 block">
                    Kicker
                  </label>
                  <input
                    id={`kicker-${section.id}`}
                    name="kicker"
                    defaultValue={section.kicker}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor={`heading-${section.id}`} className="label mb-2 block">
                    Heading
                  </label>
                  <input
                    id={`heading-${section.id}`}
                    name="heading"
                    defaultValue={section.heading}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="mt-4">
                <label htmlFor={`body-${section.id}`} className="label mb-2 block">
                  Body — blank line between paragraphs
                </label>
                <textarea
                  id={`body-${section.id}`}
                  name="body"
                  rows={10}
                  defaultValue={section.body}
                  className={`${inputClass} resize-y`}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-6">
                <div>
                  <label htmlFor={`order-${section.id}`} className="label mb-2 block">
                    Order
                  </label>
                  <input
                    id={`order-${section.id}`}
                    name="sort_order"
                    type="number"
                    defaultValue={section.sort_order}
                    className={`${inputClass} w-24`}
                  />
                </div>
                <label className="flex items-center gap-2 pt-6 text-sm text-fog">
                  <input
                    type="checkbox"
                    name="published"
                    defaultChecked={Boolean(section.published)}
                    className="h-4 w-4 accent-[#c0603a]"
                  />
                  Published
                </label>
              </div>
            </SaveForm>
          </Panel>
        ))}
      </div>
    </AdminShell>
  );
}
