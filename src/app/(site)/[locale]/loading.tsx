export default function Loading() {
  return (
    <div className="flex min-h-[60svh] items-center justify-center" role="status" aria-live="polite">
      <span className="flex items-center gap-3 text-fog/60">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ember" />
        <span className="label">Loading</span>
      </span>
    </div>
  );
}
