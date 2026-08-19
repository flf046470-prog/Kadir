import Link from "next/link";
import { ContourField } from "@/components/visuals";

export default function NotFound() {
  return (
    <section className="relative flex min-h-[70svh] items-center overflow-hidden py-32">
      <ContourField className="pointer-events-none absolute inset-x-0 bottom-0 w-full text-fog/[0.06]" />
      <div className="shell relative">
        <p className="label text-ember">404</p>
        <h1 className="mt-5 max-w-2xl font-display text-4xl leading-tight md:text-6xl">
          This page doesn&rsquo;t exist
        </h1>
        <p className="prose-valley mt-6 max-w-lg text-fog">
          The link may be old, or the page may not have been written yet.
        </p>
        <Link
          href="/"
          className="mt-10 inline-flex rounded-full bg-snow px-7 py-4 text-xs font-medium tracking-[0.14em] text-basalt uppercase transition-colors hover:bg-ember"
        >
          Back to the project
        </Link>
      </div>
    </section>
  );
}
