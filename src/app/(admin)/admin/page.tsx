import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { countMembers } from "@/lib/content";
import { getCommunityStats, getVoteTallies, listIdeas } from "@/lib/community";
import { getPhases, getPosts, getGalleryImages } from "@/lib/content";
import { getAirbnbUrl, getPaymentConfig } from "@/lib/config";
import { getEmailService } from "@/services/email";
import { AdminShell, Panel } from "./ui";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const admin = await requireAdmin();

  const members = countMembers();
  const stats = getCommunityStats();
  const { total, tallies } = getVoteTallies();
  const phases = getPhases();
  const current = phases.find((p) => p.status === "in_progress");
  const drafts = getPosts("all", { includeDrafts: true }).filter((p) => !p.published);
  const newIdeas = listIdeas({ status: "new" });
  const images = getGalleryImages(undefined, true);
  const payments = getPaymentConfig();
  const airbnb = getAirbnbUrl();
  const email = getEmailService();

  const figures = [
    { label: "Subscribers", value: members.active },
    { label: "Feedback responses", value: total },
    { label: "Ideas received", value: stats.ideas },
    { label: "Early-guest list", value: stats.earlyAccess },
  ];

  const integrations = [
    {
      label: "Email provider",
      value: email.configured ? email.name : `${email.name} (not configured)`,
      ok: email.configured,
      note: "Sign-ups are stored in the database either way.",
    },
    {
      label: "Payments",
      value: payments.enabled ? payments.provider : "not connected",
      ok: payments.enabled,
      note: "The support section shows an honest 'not open' state while this is off.",
    },
    {
      label: "Airbnb listing",
      value: airbnb ? "configured" : "no URL set",
      ok: Boolean(airbnb),
      note: "Set AIRBNB_URL to turn on the Book on Airbnb button.",
    },
  ];

  return (
    <AdminShell
      title="Overview"
      intro="Real counts from the database. Nothing here is estimated, and nothing is shown publicly unless you publish it."
      email={admin.email}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {figures.map((figure) => (
          <div key={figure.label} className="card-stone p-5">
            <p className="font-display text-4xl text-snow">{figure.value}</p>
            <p className="label mt-2 text-fog/70">{figure.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Community answers" meta={`${total} recorded`}>
          {total > 0 ? (
            <ul className="space-y-3">
              {tallies.map((tally) => (
                <li key={tally.choice}>
                  <div className="flex justify-between text-sm">
                    <span className="text-mist capitalize">{tally.choice}</span>
                    <span className="text-fog/70">
                      {tally.count} · {tally.percent}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 rounded-full bg-fog/12">
                    <span
                      className="block h-full rounded-full bg-ember"
                      style={{ width: `${tally.percent}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fog">
              Nobody has answered yet. The public page shows no percentages until someone does.
            </p>
          )}
        </Panel>

        <Panel title="Needs your attention">
          <ul className="space-y-3 text-sm">
            <li className="flex justify-between gap-4">
              <span className="text-fog">Current phase</span>
              <span className="text-snow">{current ? current.name : "none in progress"}</span>
            </li>
            <li className="flex justify-between gap-4">
              <Link href="/admin/ideas" className="text-fog hover:text-snow">
                Unread ideas
              </Link>
              <span className={newIdeas.length ? "text-ember" : "text-snow"}>
                {newIdeas.length}
              </span>
            </li>
            <li className="flex justify-between gap-4">
              <Link href="/admin/posts" className="text-fog hover:text-snow">
                Unpublished drafts
              </Link>
              <span className="text-snow">{drafts.length}</span>
            </li>
            <li className="flex justify-between gap-4">
              <Link href="/admin/gallery" className="text-fog hover:text-snow">
                Gallery images
              </Link>
              <span className="text-snow">{images.length}</span>
            </li>
          </ul>
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title="Integrations">
          <ul className="divide-y divide-fog/10">
            {integrations.map((item) => (
              <li key={item.label} className="flex flex-wrap items-baseline justify-between gap-3 py-3">
                <div>
                  <p className="text-sm text-snow">{item.label}</p>
                  <p className="mt-1 text-xs text-fog/60">{item.note}</p>
                </div>
                <span className={`text-sm ${item.ok ? "text-moss" : "text-fog/60"}`}>
                  {item.value}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </AdminShell>
  );
}
