import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { countMembers, listMemberCountries, listMembers } from "@/lib/content";
import { formatDate } from "@/lib/format";
import { updateMemberAction } from "../actions";
import { AdminShell, Panel, inputClass } from "../ui";

export const dynamic = "force-dynamic";

type Search = Promise<{ q?: string; country?: string; status?: string }>;

export default async function AdminCommunityPage({ searchParams }: { searchParams: Search }) {
  const admin = await requireAdmin();
  const { q = "", country = "", status = "" } = await searchParams;

  const members = listMembers({ search: q, country, status });
  const countries = listMemberCountries();
  const counts = countMembers();

  const exportQuery = new URLSearchParams(
    Object.entries({ q, country, status }).filter(([, v]) => v),
  ).toString();

  return (
    <AdminShell
      title="Community"
      intro="Everyone who asked for updates. Exports respect the filters below."
      email={admin.email}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Total", value: counts.total },
          { label: "Active", value: counts.active },
          { label: "Countries", value: countries.length },
        ].map((item) => (
          <div key={item.label} className="card-stone p-5">
            <p className="font-display text-4xl text-snow">{item.value}</p>
            <p className="label mt-2 text-fog/70">{item.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <Panel title={`Members (${members.length})`}>
          <form className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search name or email"
              aria-label="Search"
              className={inputClass}
            />
            <select name="country" defaultValue={country} aria-label="Country" className={inputClass}>
              <option value="">All countries</option>
              {countries.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select name="status" defaultValue={status} aria-label="Status" className={inputClass}>
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <button
              type="submit"
              className="rounded-full border border-fog/20 px-5 py-2 text-xs tracking-wide text-snow transition-colors hover:border-ember hover:text-ember"
            >
              Filter
            </button>
          </form>

          <div className="mt-4 flex flex-wrap gap-4">
            <Link
              href={`/admin/community/export${exportQuery ? `?${exportQuery}` : ""}`}
              prefetch={false}
              className="text-xs text-ember hover:text-snow"
            >
              Download CSV
            </Link>
            {q || country || status ? (
              <Link href="/admin/community" className="text-xs text-fog/60 hover:text-snow">
                Clear filters
              </Link>
            ) : null}
          </div>

          {members.length === 0 ? (
            <p className="mt-6 text-sm text-fog">Nobody matches this filter yet.</p>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[46rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-fog/15 text-fog/60">
                    <th scope="col" className="py-2 pe-4 font-normal">Name</th>
                    <th scope="col" className="py-2 pe-4 font-normal">Email</th>
                    <th scope="col" className="py-2 pe-4 font-normal">Country</th>
                    <th scope="col" className="py-2 pe-4 font-normal">Interests</th>
                    <th scope="col" className="py-2 pe-4 font-normal">Joined</th>
                    <th scope="col" className="py-2 pe-4 font-normal">Status</th>
                    <th scope="col" className="py-2 font-normal">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-fog/10">
                  {members.map((member) => (
                    <tr key={member.id}>
                      <td className="py-3 pe-4 text-mist">{member.first_name}</td>
                      <td className="py-3 pe-4 text-mist">{member.email}</td>
                      <td className="py-3 pe-4 text-fog">{member.country || "—"}</td>
                      <td className="py-3 pe-4 text-xs text-fog/70">
                        {member.interests ? member.interests.replace(/,/g, ", ") : "—"}
                      </td>
                      <td className="py-3 pe-4 text-fog/70">{formatDate(member.created_at)}</td>
                      <td className="py-3 pe-4">
                        <span className={member.status === "active" ? "text-moss" : "text-fog/50"}>
                          {member.status}
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="flex gap-4">
                          <form action={updateMemberAction}>
                            <input type="hidden" name="id" value={member.id} />
                            <input type="hidden" name="intent" value="toggle" />
                            <button type="submit" className="text-xs text-fog/70 hover:text-ember">
                              {member.status === "active" ? "Deactivate" : "Activate"}
                            </button>
                          </form>
                          <form action={updateMemberAction}>
                            <input type="hidden" name="id" value={member.id} />
                            <input type="hidden" name="intent" value="delete" />
                            <button type="submit" className="text-xs text-fog/60 hover:text-tulip">
                              Delete
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </AdminShell>
  );
}
