import { notFound } from "next/navigation";
import { currentModerator } from "@/auth/moderator";
import { photoQueue, reportQueue, queueCounts } from "@/db/moderation";
import { ModerationConsole } from "./ModerationConsole";

export const dynamic = "force-dynamic";

/**
 * Moderation console.
 *
 * A member without the role gets `notFound()` — the same 404 the API returns.
 * Confirming this page exists would tell an attacker exactly what to target.
 */
export default async function ModerationPage() {
  const moderator = await currentModerator();
  if (!moderator) notFound();

  const [photos, reports, counts] = await Promise.all([
    photoQueue(),
    reportQueue(),
    queueCounts()
  ]);

  return (
    <ModerationConsole
      initialPhotos={photos.map((photo) => ({
        id: photo.id,
        url: photo.url,
        displayName: photo.displayName,
        createdAt: photo.createdAt.toISOString()
      }))}
      initialReports={reports.map((report) => ({
        id: report.id,
        reportedName: report.reportedName,
        reason: report.reason,
        details: report.details,
        messageBody: report.messageBody,
        stage: report.stage,
        createdAt: report.createdAt.toISOString()
      }))}
      counts={counts}
    />
  );
}
