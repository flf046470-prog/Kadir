export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-display text-lg font-semibold text-ink sm:gap-2 sm:text-xl ${className}`}>
      <svg width="26" height="26" viewBox="0 0 28 28" fill="none" aria-hidden="true" className="shrink-0">
        <path
          d="M14 24.5s-9.5-5.86-9.5-13.02C4.5 7.4 7.55 4.5 11.1 4.5c1.99 0 3.7 1 4.9 2.62A6.02 6.02 0 0 1 20.9 4.5c3.55 0 6.6 2.9 6.6 6.98C27.5 18.64 18 24.5 14 24.5Z"
          fill="url(#fm-grad)"
        />
        <defs>
          <linearGradient id="fm-grad" x1="4.5" y1="4.5" x2="27.5" y2="24.5" gradientUnits="userSpaceOnUse">
            <stop stopColor="#fb6f92" />
            <stop offset="1" stopColor="#8360f5" />
          </linearGradient>
        </defs>
      </svg>
      FioreMatch
    </span>
  );
}
