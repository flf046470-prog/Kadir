import { requireAdmin } from "@/lib/auth";
import { listIdeas } from "@/lib/community";
import { formatDate } from "@/lib/format";
import { updateIdeaAction } from "../actions";
import { AdminShell, Panel } from "../ui";

export const dynamic = "force-dynamic";

function IdeaButton({
  id,
  intent,
  label,
  tone = "default",
}: {
  id: number;
  intent: string;
  label: string;
  tone?: "default" | "danger";
}) {
  return (
    <form action={updateIdeaAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="intent" value={intent} />
      <button
        type="submit"
        className={`text-xs transition-colors ${
          tone === "danger" ? "text-fog/60 hover:text-tulip" : "text-fog/70 hover:text-ember"
        }`}
      >
        {label}
      </button>
    </form>
  );
}

export default async function AdminIdeasPage() {
  const admin = await requireAdmin();
  const ideas = listIdeas();

  return (
    <AdminShell
      title="Ideas"
      intro="What people sent through the community form. Publishing shows the message and the name on the home page — email addresses are never published."
      email={admin.email}
    >
      <Panel title={`Received (${ideas.length})`}>
        {ideas.length === 0 ? (
          <p className="text-sm text-fog">No ideas have been sent yet.</p>
        ) : (
          <ul className="divide-y divide-fog/10">
            {ideas.map((idea) => (
              <li key={idea.id} className="py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="text-sm text-snow">
                    {idea.name || "Anonymous"}
                    {idea.country ? <span className="text-fog/60"> · {idea.country}</span> : null}
                  </p>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-fog/50">{formatDate(idea.created_at)}</span>
                    {idea.published ? (
                      <span className="text-xs text-moss">published</span>
                    ) : idea.status === "archived" ? (
                      <span className="text-xs text-fog/50">archived</span>
                    ) : null}
                  </div>
                </div>

                <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-mist">
                  {idea.body}
                </p>

                {idea.email ? (
                  <p className="mt-3 text-xs text-fog/60">Reply to: {idea.email}</p>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-5">
                  {idea.published ? (
                    <IdeaButton id={idea.id} intent="unpublish" label="Unpublish" />
                  ) : (
                    <IdeaButton
                      id={idea.id}
                      intent="publish"
                      label={idea.name ? "Publish on the site" : "Publish (shows as Anonymous)"}
                    />
                  )}
                  <IdeaButton id={idea.id} intent="archive" label="Archive" />
                  <IdeaButton id={idea.id} intent="delete" label="Delete" tone="danger" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </AdminShell>
  );
}
