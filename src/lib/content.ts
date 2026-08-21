import "server-only";

import { getDb } from "./db";
import { SETTING_DEFAULTS } from "./settings-schema";

export type PhaseStatus = "not_started" | "in_progress" | "completed" | "on_hold";

export type Phase = {
  id: number;
  slug: string;
  name: string;
  description: string;
  status: PhaseStatus;
  date_label: string;
  progress: number;
  sort_order: number;
  updated_at: string;
};

export type StorySection = {
  id: number;
  slug: string;
  kicker: string;
  heading: string;
  body: string;
  sort_order: number;
  published: number;
  updated_at: string;
};

export type PostKind = "journal" | "update";

export type Post = {
  id: number;
  kind: PostKind;
  slug: string;
  title: string;
  entry_date: string;
  phase_slug: string;
  excerpt: string;
  body: string;
  image_path: string;
  image_alt: string;
  video_url: string;
  published: number;
  created_at: string;
  updated_at: string;
};

export type GalleryImage = {
  id: number;
  file_path: string;
  title: string;
  description: string;
  location: string;
  photographer: string;
  source_url: string;
  license: string;
  category: "patagonia" | "project";
  season: string;
  /** What the image shows: "Interior", "Floor plan", "Exterior — night"… */
  subject: string;
  alt_text: string;
  width: number;
  height: number;
  sort_order: number;
  published: number;
  created_at: string;
};

export type CommunityMember = {
  id: number;
  first_name: string;
  email: string;
  country: string;
  consent: number;
  status: string;
  source: string;
  interests: string;
  locale: string;
  created_at: string;
};

/* ── settings ─────────────────────────────────────────────────────────── */

export function getSettings(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...SETTING_DEFAULTS, ...stored };
}

export function setSettings(values: Record<string, string>) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);
  db.transaction(() => {
    for (const [key, value] of Object.entries(values)) stmt.run(key, value ?? "");
  })();
}

export type SocialLink = { key: string; label: string; url: string };

export function getSocialLinks(settings?: Record<string, string>): SocialLink[] {
  const s = settings ?? getSettings();
  return (
    [
      { key: "instagram", label: "Instagram" },
      { key: "tiktok", label: "TikTok" },
      { key: "youtube", label: "YouTube" },
      { key: "facebook", label: "Facebook" },
      { key: "x", label: "X" },
    ] as const
  )
    .map((item) => ({ ...item, url: (s[`social.${item.key}`] ?? "").trim() }))
    .filter((item) => item.url.length > 0);
}

/* ── story ────────────────────────────────────────────────────────────── */

export function getStorySections(includeHidden = false): StorySection[] {
  const where = includeHidden ? "" : "WHERE published = 1";
  return getDb()
    .prepare(`SELECT * FROM story_sections ${where} ORDER BY sort_order, id`)
    .all() as StorySection[];
}

export function getStorySection(slug: string): StorySection | undefined {
  return getDb()
    .prepare("SELECT * FROM story_sections WHERE slug = ?")
    .get(slug) as StorySection | undefined;
}

/* ── phases ───────────────────────────────────────────────────────────── */

export function getPhases(): Phase[] {
  return getDb()
    .prepare("SELECT * FROM progress_phases ORDER BY sort_order, id")
    .all() as Phase[];
}

export function getCurrentPhase(phases?: Phase[]): Phase | undefined {
  const list = phases ?? getPhases();
  return (
    list.find((p) => p.status === "in_progress") ??
    [...list].reverse().find((p) => p.status === "completed") ??
    list[0]
  );
}

/* ── posts ────────────────────────────────────────────────────────────── */

export function getPosts(
  kind: PostKind | "all",
  { includeDrafts = false, limit }: { includeDrafts?: boolean; limit?: number } = {},
): Post[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (kind !== "all") {
    clauses.push("kind = ?");
    params.push(kind);
  }
  if (!includeDrafts) clauses.push("published = 1");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limitSql = limit ? "LIMIT ?" : "";
  if (limit) params.push(limit);
  return getDb()
    .prepare(
      `SELECT * FROM posts ${where} ORDER BY entry_date DESC, id DESC ${limitSql}`,
    )
    .all(...params) as Post[];
}

export function getPostBySlug(slug: string, includeDrafts = false): Post | undefined {
  const row = getDb().prepare("SELECT * FROM posts WHERE slug = ?").get(slug) as
    | Post
    | undefined;
  if (!row) return undefined;
  if (!includeDrafts && !row.published) return undefined;
  return row;
}

/* ── gallery ──────────────────────────────────────────────────────────── */

export function getGalleryImages(
  category?: "patagonia" | "project",
  includeHidden = false,
): GalleryImage[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (category) {
    clauses.push("category = ?");
    params.push(category);
  }
  if (!includeHidden) clauses.push("published = 1");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return getDb()
    .prepare(`SELECT * FROM gallery_images ${where} ORDER BY sort_order, id DESC`)
    .all(...params) as GalleryImage[];
}

/* ── community ────────────────────────────────────────────────────────── */

export function listMembers({
  search = "",
  country = "",
  status = "",
}: { search?: string; country?: string; status?: string } = {}): CommunityMember[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (search) {
    clauses.push("(first_name LIKE ? OR email LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  if (country) {
    clauses.push("country = ?");
    params.push(country);
  }
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return getDb()
    .prepare(`SELECT * FROM community_members ${where} ORDER BY created_at DESC, id DESC`)
    .all(...params) as CommunityMember[];
}

export function listMemberCountries(): string[] {
  const rows = getDb()
    .prepare(
      "SELECT DISTINCT country FROM community_members WHERE country <> '' ORDER BY country",
    )
    .all() as { country: string }[];
  return rows.map((r) => r.country);
}

export function countMembers(): { total: number; active: number } {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active FROM community_members",
    )
    .get() as { total: number; active: number | null };
  return { total: row.total, active: row.active ?? 0 };
}

export type SubscribeResult = "created" | "already_member";

export function addMember(input: {
  firstName: string;
  email: string;
  country: string;
  source?: string;
  interests?: string[];
  locale?: string;
}): SubscribeResult {
  const db = getDb();
  const interests = (input.interests ?? []).join(",");
  const existing = db
    .prepare("SELECT id, interests FROM community_members WHERE email = ?")
    .get(input.email) as { id: number; interests: string } | undefined;

  if (existing) {
    // Interests are additive: signing up from a second form adds that interest
    // rather than replacing what the person already asked for.
    const merged = Array.from(
      new Set([...existing.interests.split(","), ...(input.interests ?? [])].filter(Boolean)),
    ).join(",");
    db.prepare(
      `UPDATE community_members
       SET first_name = ?, country = ?, status = 'active', consent = 1, interests = ?
       WHERE id = ?`,
    ).run(input.firstName || "", input.country, merged, existing.id);
    return "already_member";
  }

  db.prepare(
    `INSERT INTO community_members (first_name, email, country, consent, status, source, interests, locale)
     VALUES (?, ?, ?, 1, 'active', ?, ?, ?)`,
  ).run(
    input.firstName,
    input.email,
    input.country,
    input.source ?? "website",
    interests,
    input.locale ?? "",
  );
  return "created";
}
