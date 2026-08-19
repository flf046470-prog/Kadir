import { z } from "zod";

/** Strips control characters that have no business in a form field. */
const clean = (value: unknown) =>
  typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim()
    : value;

export const subscribeSchema = z.object({
  firstName: z.preprocess(clean, z.string().min(1, "Please add your first name").max(80)),
  email: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.string().min(5).max(160).email("Please check your email address"),
  ),
  country: z.preprocess(clean, z.string().max(80)),
  consent: z
    .unknown()
    .refine((v) => v === true || v === "on" || v === "true", {
      message: "Please confirm you would like to receive project updates",
    }),
  // Honeypot: real people leave it empty.
  website: z.preprocess(clean, z.string().max(0, "Rejected")),
});

export const loginSchema = z.object({
  email: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().email()),
  password: z.string().min(1).max(200),
});

export const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes only");

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Escapes a value for CSV, including the leading-character injection guard. */
export function csvCell(value: string): string {
  const raw = value ?? "";
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** Accepts only http(s) URLs, so admin-entered links cannot become javascript:. */
export function safeExternalUrl(value: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}
