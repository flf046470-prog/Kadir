/** Dates are stored as YYYY-MM-DD and rendered in a fixed, unambiguous form. */
export function formatDate(value: string): string {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function paragraphs(body: string): string[] {
  return (body ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function lines(body: string): string[] {
  return (body ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
