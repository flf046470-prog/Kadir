import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import type { Phase, PhaseStatus, Post } from "@/lib/content";
import { formatDate, paragraphs } from "@/lib/format";
import { ContourField } from "./visuals";
import { Reveal } from "./reveal";

/* ── page furniture ───────────────────────────────────────────────────── */

export function PageHeader({
  kicker,
  title,
  intro,
  aside,
}: {
  kicker: string;
  title: string;
  intro?: string;
  aside?: ReactNode;
}) {
  return (
    <header className="relative overflow-hidden border-b border-fog/10 pt-28 pb-16 md:pt-40 md:pb-24">
      <ContourField className="pointer-events-none absolute -top-16 right-0 w-[120%] max-w-none text-fog/[0.07] md:w-[70%]" />
      <div className="shell relative">
        <p className="label text-ember">{kicker}</p>
        <h1 className="mt-5 max-w-4xl font-display text-[2.6rem] leading-[1.05] md:text-[4.25rem]">
          {title}
        </h1>
        {intro ? (
          <p className="prose-valley mt-7 max-w-2xl text-fog">{intro}</p>
        ) : null}
        {aside ? <div className="mt-8">{aside}</div> : null}
      </div>
    </header>
  );
}

export function SectionHeading({
  kicker,
  title,
  className = "",
}: {
  kicker?: string;
  title: string;
  className?: string;
}) {
  return (
    <div className={className}>
      {kicker ? <p className="label text-ember">{kicker}</p> : null}
      <h2 className="mt-4 font-display text-3xl leading-tight md:text-[2.75rem]">{title}</h2>
    </div>
  );
}

export function Prose({ body, className = "" }: { body: string; className?: string }) {
  return (
    <div className={`prose-valley ${className}`}>
      {paragraphs(body).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="card-stone relative overflow-hidden px-6 py-14 text-center md:px-12 md:py-20">
      <ContourField className="pointer-events-none absolute inset-x-0 bottom-0 w-full text-fog/[0.06]" />
      <div className="relative mx-auto max-w-xl">
        <p className="label text-ember">Nothing here yet — on purpose</p>
        <h3 className="mt-5 font-display text-2xl md:text-3xl">{title}</h3>
        <p className="mt-4 text-fog">{body}</p>
        {action ? <div className="mt-8">{action}</div> : null}
      </div>
    </div>
  );
}

export function CtaLink({
  href,
  children,
  variant = "solid",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: "solid" | "ghost";
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full px-7 py-4 text-xs font-medium tracking-[0.14em] uppercase transition-colors";
  const styles =
    variant === "solid"
      ? "bg-snow text-basalt hover:bg-ember"
      : "border border-fog/25 text-snow hover:border-ember hover:text-ember";
  return (
    <Link href={href} className={`${base} ${styles} ${className}`}>
      {children}
    </Link>
  );
}

/* ── phases ───────────────────────────────────────────────────────────── */

export const PHASE_STATUS_LABEL: Record<PhaseStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  on_hold: "On hold",
};

const STATUS_STYLES: Record<PhaseStatus, { dot: string; text: string; border: string }> = {
  not_started: { dot: "bg-fog/30", text: "text-fog/70", border: "border-fog/15" },
  in_progress: { dot: "bg-ember", text: "text-ember", border: "border-ember/40" },
  completed: { dot: "bg-moss", text: "text-moss", border: "border-moss/40" },
  on_hold: { dot: "bg-tulip", text: "text-tulip", border: "border-tulip/40" },
};

export function PhaseBadge({ status }: { status: PhaseStatus }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.not_started;
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${style.border}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      <span className={`label ${style.text}`}>{PHASE_STATUS_LABEL[status] ?? status}</span>
    </span>
  );
}

/**
 * The journey timeline. A progress bar only appears when a real percentage has
 * been recorded — an empty phase shows its status in words instead of a 0% bar.
 */
export function PhaseTimeline({ phases }: { phases: Phase[] }) {
  return (
    <ol className="relative">
      <span
        aria-hidden="true"
        className="absolute top-2 bottom-2 left-[7px] w-px bg-gradient-to-b from-moss/50 via-fog/20 to-transparent md:left-[9px]"
      />
      {phases.map((phase, index) => {
        const style = STATUS_STYLES[phase.status] ?? STATUS_STYLES.not_started;
        const showBar = phase.status === "in_progress" && phase.progress > 0;
        return (
          <Reveal as="li" key={phase.id} className="relative pb-12 pl-9 last:pb-0 md:pl-14" delay={index * 45}>
            <span
              aria-hidden="true"
              className={`absolute top-1.5 left-0 h-4 w-4 rounded-full border-2 border-basalt ${style.dot} md:h-5 md:w-5`}
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <h3 className="font-display text-2xl md:text-3xl">{phase.name}</h3>
              <PhaseBadge status={phase.status} />
              {phase.date_label ? (
                <span className="label text-fog/60">{phase.date_label}</span>
              ) : null}
            </div>
            {phase.description ? (
              <p className="mt-3 max-w-2xl leading-relaxed text-fog">{phase.description}</p>
            ) : null}
            {showBar ? (
              <div className="mt-5 max-w-sm">
                <div
                  className="h-1 w-full overflow-hidden rounded-full bg-fog/15"
                  role="progressbar"
                  aria-valuenow={phase.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${phase.name} progress`}
                >
                  <span
                    className="block h-full rounded-full bg-ember"
                    style={{ width: `${Math.min(100, Math.max(0, phase.progress))}%` }}
                  />
                </div>
                <p className="label mt-2 text-fog/60">{phase.progress}% recorded</p>
              </div>
            ) : null}
          </Reveal>
        );
      })}
    </ol>
  );
}

/** Compact horizontal phase rail used in the hero and page headers. */
export function PhaseRail({ phases }: { phases: Phase[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {phases.map((phase, i) => {
        const style = STATUS_STYLES[phase.status] ?? STATUS_STYLES.not_started;
        return (
          <li key={phase.id} className="flex items-center gap-3">
            <span className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
              <span
                className={`label ${
                  phase.status === "in_progress"
                    ? "text-ember"
                    : phase.status === "completed"
                      ? "text-mist"
                      : "text-fog/45"
                }`}
              >
                {phase.name}
              </span>
            </span>
            {i < phases.length - 1 ? (
              <span aria-hidden="true" className="h-px w-4 bg-fog/20 md:w-6" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/* ── posts ────────────────────────────────────────────────────────────── */

export function PostCard({ post, basePath }: { post: Post; basePath: string }) {
  return (
    <article className="card-stone group overflow-hidden">
      <Link href={`${basePath}/${post.slug}`} className="block">
        {post.image_path ? (
          <div className="relative aspect-[16/10] overflow-hidden bg-stone">
            <Image
              src={post.image_path}
              alt={post.image_alt || post.title}
              fill
              sizes="(max-width: 768px) 100vw, 33vw"
              className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
            />
          </div>
        ) : null}
        <div className="p-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <time dateTime={post.entry_date} className="label text-ember">
              {formatDate(post.entry_date)}
            </time>
            {post.phase_slug ? (
              <span className="label text-fog/60">· {post.phase_slug.replace(/-/g, " ")}</span>
            ) : null}
          </div>
          <h3 className="mt-3 font-display text-2xl leading-snug transition-colors group-hover:text-ember">
            {post.title}
          </h3>
          {post.excerpt ? (
            <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-fog">{post.excerpt}</p>
          ) : null}
          <span className="label mt-5 inline-block text-snow">Read →</span>
        </div>
      </Link>
    </article>
  );
}
