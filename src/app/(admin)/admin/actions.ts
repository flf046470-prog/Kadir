"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  authenticate,
  changePassword,
  createSession,
  destroySession,
  requireAdmin,
} from "@/lib/auth";
import { getDb } from "@/lib/db";
import { setSettings } from "@/lib/content";
import { rateLimit } from "@/lib/rate-limit";
import { getClientKey } from "@/lib/request";
import { seedIfEmpty } from "@/lib/seed";
import { SETTINGS } from "@/lib/settings-schema";
import { loginSchema, slugify } from "@/lib/validation";
import { deleteUpload, saveUpload } from "@/lib/upload";
import type { ActionState } from "./state";



function field(formData: FormData, key: string, max = 4000): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.slice(0, max).trim() : "";
}

function flag(formData: FormData, key: string): number {
  return formData.get(key) ? 1 : 0;
}

/* ── session ──────────────────────────────────────────────────────────── */

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  seedIfEmpty();

  const key = await getClientKey();
  if (!rateLimit(`login:${key}`, { limit: 8, windowSeconds: 900 }).ok) {
    return { status: "error", message: "Too many attempts. Wait fifteen minutes and try again." };
  }

  const parsed = loginSchema.safeParse({
    email: formData.get("email") ?? "",
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) {
    return { status: "error", message: "Enter an email address and password." };
  }

  const admin = authenticate(parsed.data.email, parsed.data.password);
  // The same message for a wrong password and an unknown account.
  if (!admin) return { status: "error", message: "Those details don't match." };

  await createSession(admin.id);
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/admin/login");
}

export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const current = field(formData, "currentPassword", 200);
  const next = field(formData, "newPassword", 200);

  if (next.length < 12) {
    return { status: "error", message: "Use at least 12 characters for the new password." };
  }
  if (!changePassword(admin.id, current, next)) {
    return { status: "error", message: "The current password is not correct." };
  }
  redirect("/admin/login");
}

/* ── settings ─────────────────────────────────────────────────────────── */

export async function saveSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const values: Record<string, string> = {};
  for (const setting of SETTINGS) {
    const raw = formData.get(setting.key);
    if (typeof raw !== "string") continue;
    const value = raw.slice(0, 8000).trim();
    if (setting.type === "url" && value && !/^https?:\/\//i.test(value)) {
      return { status: "error", message: `${setting.label} must start with http:// or https://` };
    }
    values[setting.key] = value;
  }

  setSettings(values);
  revalidatePath("/", "layout");
  return { status: "success", message: "Saved." };
}

/* ── story ────────────────────────────────────────────────────────────── */

export async function saveStoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const db = getDb();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return { status: "error", message: "Unknown section." };

  db.prepare(
    `UPDATE story_sections
     SET kicker = ?, heading = ?, body = ?, sort_order = ?, published = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    field(formData, "kicker", 120),
    field(formData, "heading", 200),
    field(formData, "body", 20000),
    Number(formData.get("sort_order")) || 0,
    flag(formData, "published"),
    id,
  );

  revalidatePath("/", "layout");
  return { status: "success", message: "Section saved." };
}

/* ── phases ───────────────────────────────────────────────────────────── */

export async function savePhaseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return { status: "error", message: "Unknown phase." };

  const status = field(formData, "status", 20);
  if (!["not_started", "in_progress", "completed", "on_hold"].includes(status)) {
    return { status: "error", message: "Pick a valid status." };
  }

  const progress = Math.max(0, Math.min(100, Number(formData.get("progress")) || 0));
  if (status === "not_started" && progress > 0) {
    return {
      status: "error",
      message: "A phase that has not started cannot have progress recorded against it.",
    };
  }

  getDb()
    .prepare(
      `UPDATE progress_phases
       SET name = ?, description = ?, status = ?, date_label = ?, progress = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(
      field(formData, "name", 120),
      field(formData, "description", 4000),
      status,
      field(formData, "date_label", 80),
      status === "completed" ? 100 : progress,
      id,
    );

  revalidatePath("/", "layout");
  return { status: "success", message: "Phase saved." };
}

/* ── posts (journal + updates) ────────────────────────────────────────── */

export async function savePostAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const db = getDb();

  const id = Number(formData.get("id")) || 0;
  const title = field(formData, "title", 200);
  const entryDate = field(formData, "entry_date", 10);
  const kind = field(formData, "kind", 10) === "journal" ? "journal" : "update";

  if (!title) return { status: "error", message: "Give the entry a title." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    return { status: "error", message: "Use a date in the form YYYY-MM-DD." };
  }

  let imagePath = field(formData, "image_path", 300);
  const upload = formData.get("image");
  if (upload instanceof File && upload.size > 0) {
    const result = await saveUpload(upload);
    if (!result.ok) return { status: "error", message: result.error };
    imagePath = result.filePath;
  }

  const videoUrl = field(formData, "video_url", 500);
  if (videoUrl && !/^(https?:\/\/|\/uploads\/)/.test(videoUrl)) {
    return { status: "error", message: "The video URL must be an http(s) link or an upload path." };
  }

  const base = slugify(field(formData, "slug", 80) || title) || `entry-${Date.now()}`;
  const values = [
    kind,
    title,
    entryDate,
    field(formData, "phase_slug", 40),
    field(formData, "excerpt", 500),
    field(formData, "body", 40000),
    imagePath,
    field(formData, "image_alt", 300),
    videoUrl,
    flag(formData, "published"),
  ];

  try {
    if (id) {
      db.prepare(
        `UPDATE posts SET kind = ?, title = ?, entry_date = ?, phase_slug = ?, excerpt = ?,
           body = ?, image_path = ?, image_alt = ?, video_url = ?, published = ?, slug = ?,
           updated_at = datetime('now')
         WHERE id = ?`,
      ).run(...values, base, id);
    } else {
      db.prepare(
        `INSERT INTO posts (kind, title, entry_date, phase_slug, excerpt, body, image_path,
           image_alt, video_url, published, slug)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(...values, base);
    }
  } catch {
    return { status: "error", message: "That slug is already used by another entry." };
  }

  revalidatePath("/", "layout");
  return { status: "success", message: "Entry saved." };
}

export async function deletePostAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;

  const db = getDb();
  const row = db.prepare("SELECT image_path FROM posts WHERE id = ?").get(id) as
    | { image_path: string }
    | undefined;
  db.prepare("DELETE FROM posts WHERE id = ?").run(id);
  if (row?.image_path) await deleteUpload(row.image_path);

  revalidatePath("/", "layout");
  redirect("/admin/posts");
}

/* ── gallery ──────────────────────────────────────────────────────────── */

export async function saveImageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const db = getDb();
  const id = Number(formData.get("id")) || 0;

  let filePath = field(formData, "file_path", 300);
  const upload = formData.get("image");
  if (upload instanceof File && upload.size > 0) {
    const result = await saveUpload(upload);
    if (!result.ok) return { status: "error", message: result.error };
    filePath = result.filePath;
  }
  if (!filePath) return { status: "error", message: "Choose an image to upload." };

  const altText = field(formData, "alt_text", 300);
  if (!altText) {
    return { status: "error", message: "Alt text is required — it is what screen readers read." };
  }

  const license = field(formData, "license", 120);
  if (!license) {
    return {
      status: "error",
      message: "Record the licence. An image with no known licence does not go on the site.",
    };
  }

  const category = field(formData, "category", 20) === "project" ? "project" : "patagonia";
  const values = [
    filePath,
    field(formData, "title", 200),
    field(formData, "description", 1000),
    field(formData, "location", 200),
    field(formData, "photographer", 200),
    field(formData, "source_url", 500),
    license,
    category,
    field(formData, "season", 20),
    altText,
    Number(formData.get("sort_order")) || 0,
    flag(formData, "published"),
  ];

  if (id) {
    db.prepare(
      `UPDATE gallery_images SET file_path = ?, title = ?, description = ?, location = ?,
         photographer = ?, source_url = ?, license = ?, category = ?, season = ?, alt_text = ?,
         sort_order = ?, published = ?
       WHERE id = ?`,
    ).run(...values, id);
  } else {
    db.prepare(
      `INSERT INTO gallery_images (file_path, title, description, location, photographer,
         source_url, license, category, season, alt_text, sort_order, published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(...values);
  }

  revalidatePath("/", "layout");
  return { status: "success", message: "Image saved." };
}

export async function deleteImageAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;

  const db = getDb();
  const row = db.prepare("SELECT file_path FROM gallery_images WHERE id = ?").get(id) as
    | { file_path: string }
    | undefined;
  db.prepare("DELETE FROM gallery_images WHERE id = ?").run(id);
  if (row?.file_path) await deleteUpload(row.file_path);

  revalidatePath("/", "layout");
  redirect("/admin/gallery");
}

/* ── community members ────────────────────────────────────────────────── */

export async function updateMemberAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const intent = String(formData.get("intent") ?? "");
  if (!Number.isInteger(id)) return;

  const db = getDb();
  if (intent === "delete") {
    db.prepare("DELETE FROM community_members WHERE id = ?").run(id);
  } else if (intent === "toggle") {
    db.prepare(
      `UPDATE community_members
       SET status = CASE status WHEN 'active' THEN 'inactive' ELSE 'active' END
       WHERE id = ?`,
    ).run(id);
  }

  revalidatePath("/admin/community");
}

/* ── ideas ────────────────────────────────────────────────────────────── */

export async function updateIdeaAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const intent = String(formData.get("intent") ?? "");
  if (!Number.isInteger(id)) return;

  const db = getDb();
  if (intent === "delete") {
    db.prepare("DELETE FROM ideas WHERE id = ?").run(id);
  } else if (intent === "publish") {
    // Publishing shows the idea and the name on the public site, so it is only
    // ever an explicit action — never a default.
    db.prepare("UPDATE ideas SET published = 1, status = 'read' WHERE id = ?").run(id);
  } else if (intent === "unpublish") {
    db.prepare("UPDATE ideas SET published = 0 WHERE id = ?").run(id);
  } else if (intent === "archive") {
    db.prepare("UPDATE ideas SET status = 'archived', published = 0 WHERE id = ?").run(id);
  }

  revalidatePath("/", "layout");
}
