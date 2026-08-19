"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="flex min-h-[70svh] items-center py-32">
      <div className="shell">
        <p className="label text-tulip">Error</p>
        <h1 className="mt-5 max-w-2xl font-display text-4xl leading-tight md:text-5xl">
          Something went wrong
        </h1>
        <p className="prose-valley mt-6 max-w-lg text-fog">
          The page failed to load. Trying again usually fixes it.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-10 rounded-full bg-snow px-7 py-4 text-xs font-medium tracking-[0.14em] text-basalt uppercase transition-colors hover:bg-ember"
        >
          Try again
        </button>
      </div>
    </section>
  );
}
