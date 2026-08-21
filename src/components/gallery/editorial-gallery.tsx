"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

export type GalleryItem = {
  id: number;
  src: string;
  alt: string;
  title: string;
  description: string;
  location: string;
  photographer: string;
  license: string;
  sourceUrl: string;
  /** What the image is: "Interior", "Floor plan", "Exterior — night"… */
  subject: string;
  width: number;
  height: number;
};

export type GalleryLabels = {
  previous: string;
  next: string;
  counter: string;
  drawing: string;
};

/**
 * The gallery, given the room it deserves.
 *
 * One image at a time, full width, crossfading; the caption and the credit sit
 * under it rather than on it. Arrow keys move on desktop, a drag moves on
 * touch, and the thumbnail rail is a real list of buttons so the whole thing is
 * reachable from the keyboard. Only the current frame and its neighbours are
 * fetched — a long gallery costs the same as a short one on arrival.
 */
export function EditorialGallery({
  items,
  labels,
  className = "",
  eager = false,
}: {
  items: GalleryItem[];
  labels: GalleryLabels;
  className?: string;
  /** Preload the first frame. Only where the gallery is the page's subject. */
  eager?: boolean;
}) {
  const [active, setActive] = useState(0);
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<{ x: number; id: number } | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);

  const go = useCallback(
    (next: number) => {
      if (items.length === 0) return;
      setActive(((next % items.length) + items.length) % items.length);
    },
    [items.length],
  );

  /* Keyboard: only while the gallery itself holds focus. */
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(active + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(active - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      go(0);
    } else if (event.key === "End") {
      event.preventDefault();
      go(items.length - 1);
    }
  };

  /* Drag / swipe. Pointer events cover mouse, pen and touch alike. */
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragStart.current = { x: event.clientX, id: event.pointerId };
    setDragging(true);
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const start = dragStart.current;
    dragStart.current = null;
    setDragging(false);
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const threshold = Math.max(40, (stageRef.current?.clientWidth ?? 400) * 0.08);
    if (dx <= -threshold) go(active + 1);
    else if (dx >= threshold) go(active - 1);
  };

  /* Keep the active thumbnail in view without scrolling the page itself. */
  useEffect(() => {
    const rail = railRef.current;
    const thumb = rail?.querySelector<HTMLElement>(`[data-thumb="${active}"]`);
    if (!rail || !thumb) return;
    const left = thumb.offsetLeft - rail.clientWidth / 2 + thumb.clientWidth / 2;
    rail.scrollTo({ left, behavior: "smooth" });
  }, [active]);

  if (items.length === 0) return null;

  const current = items[active];
  const credit = [current.photographer, current.license].filter(Boolean).join(" · ");
  // Neighbours are fetched eagerly so a swipe never lands on an empty frame.
  const near = (index: number) =>
    index === active ||
    index === (active + 1) % items.length ||
    index === (active - 1 + items.length) % items.length;

  return (
    <section
      className={className}
      aria-roledescription="carousel"
      aria-label={current.title || current.subject || "Gallery"}
    >
      <div
        ref={stageRef}
        tabIndex={0}
        role="group"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragStart.current = null;
          setDragging(false);
        }}
        className={`relative aspect-[3/4] w-full touch-pan-y overflow-hidden bg-stone select-none sm:aspect-[16/10] lg:aspect-[21/9] ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
      >
        {items.map((item, i) => (
          <div
            key={item.id}
            aria-hidden={i !== active}
            className={`absolute inset-0 transition-[opacity,transform] duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
              i === active ? "scale-100 opacity-100" : "scale-[1.04] opacity-0"
            }`}
          >
            {near(i) ? (
              <Image
                src={item.src}
                alt={item.alt || item.title || item.subject}
                fill
                sizes="100vw"
                priority={eager && i === 0}
                loading={eager && i === 0 ? undefined : "lazy"}
                draggable={false}
                className="object-cover"
              />
            ) : null}
          </div>
        ))}

        {/* Controls: quiet, at the edges, never over the middle of the image. */}
        <button
          type="button"
          onClick={() => go(active - 1)}
          aria-label={labels.previous}
          className="absolute start-0 top-0 bottom-0 flex w-16 items-center justify-center text-snow/0 transition-colors hover:bg-basalt/30 hover:text-snow focus-visible:bg-basalt/30 focus-visible:text-snow md:w-20"
        >
          <span aria-hidden="true" className="text-2xl leading-none rtl:rotate-180">
            ←
          </span>
        </button>
        <button
          type="button"
          onClick={() => go(active + 1)}
          aria-label={labels.next}
          className="absolute end-0 top-0 bottom-0 flex w-16 items-center justify-center text-snow/0 transition-colors hover:bg-basalt/30 hover:text-snow focus-visible:bg-basalt/30 focus-visible:text-snow md:w-20"
        >
          <span aria-hidden="true" className="text-2xl leading-none rtl:rotate-180">
            →
          </span>
        </button>
      </div>

      {/* Caption and credit, below the frame where they belong. */}
      <div className="mt-6 grid gap-6 md:grid-cols-[1.5fr_1fr] md:items-start">
        <div aria-live="polite">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {current.subject ? <p className="label text-ember">{current.subject}</p> : null}
            <p className="label text-fog/45">
              {labels.counter
                .replace("{n}", String(active + 1))
                .replace("{total}", String(items.length))}
            </p>
          </div>
          {current.title ? (
            <h3 className="mt-3 font-display text-2xl md:text-3xl">{current.title}</h3>
          ) : null}
          {current.description ? (
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-fog">{current.description}</p>
          ) : null}
        </div>

        <dl className="text-xs leading-relaxed text-fog/60 md:justify-self-end md:text-end">
          {current.location ? (
            <div className="flex gap-2 md:justify-end">
              <dt className="sr-only">Location</dt>
              <dd>{current.location}</dd>
            </div>
          ) : null}
          {credit ? (
            <div className="mt-1 flex gap-2 md:justify-end">
              <dt className="sr-only">Credit</dt>
              <dd>
                {current.sourceUrl ? (
                  <a
                    href={current.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-fog/30 underline-offset-4 hover:text-snow"
                  >
                    {credit}
                  </a>
                ) : (
                  credit
                )}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      {/* The rail: every frame, reachable and obvious. */}
      {items.length > 1 ? (
        <div
          ref={railRef}
          className="mt-8 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:thin]"
        >
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              data-thumb={i}
              onClick={() => go(i)}
              aria-label={`${i + 1}. ${item.subject || item.title || item.alt}`}
              aria-current={i === active}
              className={`relative h-16 w-24 shrink-0 overflow-hidden bg-stone transition-opacity md:h-20 md:w-32 ${
                i === active ? "opacity-100 ring-1 ring-ember" : "opacity-45 hover:opacity-80"
              }`}
            >
              <Image
                src={item.src}
                alt=""
                fill
                sizes="128px"
                loading="lazy"
                draggable={false}
                className="object-cover"
              />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
