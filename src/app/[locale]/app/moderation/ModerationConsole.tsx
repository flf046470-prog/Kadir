"use client";

import { useState } from "react";

type PhotoItem = { id: string; url: string; displayName: string; createdAt: string };
type ReportItem = {
  id: string;
  reportedName: string;
  reason: string;
  details: string | null;
  messageBody: string | null;
  stage: string;
  createdAt: string;
};
type Counts = { photos: number; reports: number; riskCases: number };

/**
 * Moderator working surface.
 *
 * Two deliberate frictions: rejecting or suspending requires a written reason
 * before the button does anything, and the reason is stored on the audit row.
 * Moderation decisions affect real people, so "why" is not optional.
 */
export function ModerationConsole({
  initialPhotos,
  initialReports,
  counts
}: {
  initialPhotos: PhotoItem[];
  initialReports: ReportItem[];
  counts: Counts;
}) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [reports, setReports] = useState(initialReports);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function actPhoto(id: string, action: "approve" | "reject") {
    if (action === "reject" && !notes[id]?.trim()) {
      setError("A reason is required to reject a photo.");
      return;
    }
    setBusy(id);
    setError(null);

    const response = await fetch("/api/moderation/photos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photoId: id, action, note: notes[id] })
    });

    setBusy(null);
    if (response.ok) setPhotos((current) => current.filter((photo) => photo.id !== id));
    else setError("That action could not be completed.");
  }

  async function actReport(id: string, action: "dismiss" | "suspend" | "approve") {
    if (action === "suspend" && !notes[id]?.trim()) {
      setError("A reason is required to suspend an account.");
      return;
    }
    setBusy(id);
    setError(null);

    const response = await fetch("/api/moderation/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportId: id, action, note: notes[id] })
    });

    setBusy(null);
    if (response.ok) setReports((current) => current.filter((report) => report.id !== id));
    else setError("That action could not be completed.");
  }

  return (
    <section className="container-fm py-10">
      <h1 className="font-display text-3xl font-semibold text-ink">Moderation</h1>

      <dl className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Photos pending" value={counts.photos} />
        <Stat label="Open reports" value={counts.reports} />
        <Stat label="High-risk cases" value={counts.riskCases} />
      </dl>

      {error && (
        <p className="mt-6 rounded-lg bg-bloom-50 p-3 text-sm text-bloom-700" role="alert">
          {error}
        </p>
      )}

      <h2 className="mt-12 font-display text-xl font-semibold text-ink">Photo queue</h2>
      <p className="mt-1 text-sm text-ink/60">
        Photos are hidden from other members until approved. Nothing here is screened
        automatically yet — check each one.
      </p>

      {photos.length === 0 ? (
        <p className="mt-4 text-sm text-ink/50">Queue is empty.</p>
      ) : (
        <ul className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((photo) => (
            <li key={photo.id} className="card-fm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" className="aspect-square w-full rounded-lg object-cover" />
              <p className="mt-3 text-sm font-medium text-ink">{photo.displayName}</p>
              <input
                type="text"
                placeholder="Reason (required to reject)"
                value={notes[photo.id] ?? ""}
                onChange={(event) =>
                  setNotes((current) => ({ ...current, [photo.id]: event.target.value }))
                }
                className="mt-3 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
              />
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => actPhoto(photo.id, "reject")}
                  disabled={busy === photo.id}
                  className="btn-secondary flex-1 !px-3 !py-2 text-xs"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => actPhoto(photo.id, "approve")}
                  disabled={busy === photo.id}
                  className="btn-primary flex-1 !px-3 !py-2 text-xs"
                >
                  Approve
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-14 font-display text-xl font-semibold text-ink">Reports</h2>
      <p className="mt-1 text-sm text-ink/60">
        Suspension is only reachable after a case has been moved to review — the state machine
        enforces it, not the button layout.
      </p>

      {reports.length === 0 ? (
        <p className="mt-4 text-sm text-ink/50">No open reports.</p>
      ) : (
        <ul className="mt-5 space-y-4">
          {reports.map((report) => (
            <li key={report.id} className="card-fm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-ink">{report.reportedName}</p>
                <span className="text-xs uppercase tracking-wide text-ink/40">{report.stage}</span>
              </div>
              <p className="mt-1 text-sm text-ink/70">Reason: {report.reason}</p>
              {report.details && <p className="mt-1 text-sm text-ink/60">{report.details}</p>}
              {report.messageBody && (
                <blockquote className="mt-3 rounded-lg bg-black/[0.03] p-3 text-sm text-ink/70">
                  {report.messageBody}
                </blockquote>
              )}

              <input
                type="text"
                placeholder="Reason (required to suspend)"
                value={notes[report.id] ?? ""}
                onChange={(event) =>
                  setNotes((current) => ({ ...current, [report.id]: event.target.value }))
                }
                className="mt-3 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
              />

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => actReport(report.id, "dismiss")}
                  disabled={busy === report.id}
                  className="btn-secondary !px-4 !py-2 text-xs"
                >
                  Dismiss
                </button>
                {report.stage === "reported" && (
                  <button
                    type="button"
                    onClick={() => actReport(report.id, "approve")}
                    disabled={busy === report.id}
                    className="btn-secondary !px-4 !py-2 text-xs"
                  >
                    Move to review
                  </button>
                )}
                {report.stage === "human_review" && (
                  <button
                    type="button"
                    onClick={() => actReport(report.id, "suspend")}
                    disabled={busy === report.id}
                    className="btn-primary !px-4 !py-2 text-xs"
                  >
                    Suspend account
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card-fm">
      <dt className="text-xs uppercase tracking-wide text-ink/50">{label}</dt>
      <dd className="mt-1 font-display text-3xl font-semibold text-ink">{value}</dd>
    </div>
  );
}
