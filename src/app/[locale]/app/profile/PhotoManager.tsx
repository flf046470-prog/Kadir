"use client";

import { useEffect, useRef, useState } from "react";

type Photo = {
  id: string;
  url: string;
  width: number;
  height: number;
  moderationStatus: string;
};

type Labels = {
  photos: string;
  addPhoto: string;
  pending: string;
  rejected: string;
  remove: string;
  help: string;
  errors: Record<string, string>;
};

export function PhotoManager({ labels }: { labels: Labels }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [max, setMax] = useState(6);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const response = await fetch("/api/photos");
    if (!response.ok) return;
    const body = await response.json();
    setPhotos(body.photos ?? []);
    setMax(body.max ?? 6);
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    const form = new FormData();
    form.append("photo", file);

    const response = await fetch("/api/photos", { method: "POST", body: form });
    setUploading(false);

    if (inputRef.current) inputRef.current.value = "";

    if (response.ok) {
      await load();
      return;
    }

    const body = await response.json().catch(() => ({}));
    setError(labels.errors[body.error as string] ?? labels.errors.failed);
  }

  async function handleDelete(id: string) {
    await fetch(`/api/photos?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  }

  return (
    <section className="mt-10 border-t border-black/10 pt-8">
      <h2 className="font-display text-xl font-semibold text-ink">{labels.photos}</h2>
      <p className="mt-1 text-sm text-ink/60">{labels.help}</p>

      <ul className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {photos.map((photo) => (
          <li key={photo.id} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt=""
              className="aspect-square w-full rounded-xl object-cover"
              loading="lazy"
            />
            {photo.moderationStatus !== "approved" && (
              <span className="absolute left-2 top-2 rounded-full bg-ink/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                {photo.moderationStatus === "rejected" ? labels.rejected : labels.pending}
              </span>
            )}
            <button
              type="button"
              onClick={() => handleDelete(photo.id)}
              className="mt-2 text-xs text-ink/60 hover:text-bloom-600"
            >
              {labels.remove}
            </button>
          </li>
        ))}
      </ul>

      {photos.length < max && (
        <label className="btn-secondary mt-5 inline-flex cursor-pointer">
          {uploading ? "…" : labels.addPhoto}
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleUpload}
            disabled={uploading}
            className="sr-only"
          />
        </label>
      )}

      {error && (
        <p className="mt-3 text-sm text-bloom-600" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
