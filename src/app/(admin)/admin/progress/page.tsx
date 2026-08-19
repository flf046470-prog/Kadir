import { requireAdmin } from "@/lib/auth";
import { getPhases } from "@/lib/content";
import { savePhaseAction } from "../actions";
import { SaveForm } from "../save-form";
import { AdminShell, Panel, inputClass } from "../ui";

export const dynamic = "force-dynamic";

const STATUSES = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "on_hold", label: "On hold" },
];

export default async function AdminProgressPage() {
  const admin = await requireAdmin();
  const phases = getPhases();

  return (
    <AdminShell
      title="Progress"
      intro="The seven phases. A phase marked 'not started' cannot carry a progress percentage — the form will refuse it."
      email={admin.email}
    >
      <div className="grid gap-6">
        {phases.map((phase) => (
          <Panel key={phase.id} title={phase.name} meta={phase.slug}>
            <SaveForm action={savePhaseAction}>
              <input type="hidden" name="id" value={phase.id} />

              <div className="grid gap-4 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <label htmlFor={`name-${phase.id}`} className="label mb-2 block">
                    Name
                  </label>
                  <input
                    id={`name-${phase.id}`}
                    name="name"
                    defaultValue={phase.name}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor={`status-${phase.id}`} className="label mb-2 block">
                    Status
                  </label>
                  <select
                    id={`status-${phase.id}`}
                    name="status"
                    defaultValue={phase.status}
                    className={inputClass}
                  >
                    {STATUSES.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`progress-${phase.id}`} className="label mb-2 block">
                    Progress %
                  </label>
                  <input
                    id={`progress-${phase.id}`}
                    name="progress"
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={phase.progress}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="mt-4">
                <label htmlFor={`date-${phase.id}`} className="label mb-2 block">
                  Date label — e.g. &ldquo;Started March 2026&rdquo;
                </label>
                <input
                  id={`date-${phase.id}`}
                  name="date_label"
                  defaultValue={phase.date_label}
                  className={inputClass}
                />
              </div>

              <div className="mt-4">
                <label htmlFor={`desc-${phase.id}`} className="label mb-2 block">
                  Description
                </label>
                <textarea
                  id={`desc-${phase.id}`}
                  name="description"
                  rows={4}
                  defaultValue={phase.description}
                  className={`${inputClass} resize-y`}
                />
              </div>
            </SaveForm>
          </Panel>
        ))}
      </div>
    </AdminShell>
  );
}
