import { getCurrentAdmin } from "@/lib/auth";
import { listMembers } from "@/lib/content";
import { csvCell } from "@/lib/validation";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "id",
  "first_name",
  "email",
  "country",
  "interests",
  "locale",
  "source",
  "status",
  "consent",
  "created_at",
] as const;

export async function GET(request: Request) {
  // Route handlers are not covered by the page-level guard, so this checks too.
  const admin = await getCurrentAdmin();
  if (!admin) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const members = listMembers({
    search: url.searchParams.get("q") ?? "",
    country: url.searchParams.get("country") ?? "",
    status: url.searchParams.get("status") ?? "",
  });

  const rows = [
    COLUMNS.join(","),
    ...members.map((member) =>
      COLUMNS.map((column) => csvCell(String(member[column] ?? ""))).join(","),
    ),
  ];
  const date = new Date().toISOString().slice(0, 10);

  return new Response(`﻿${rows.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="community-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
