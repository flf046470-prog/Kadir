export function PricingCard({
  name,
  price,
  period,
  desc,
  features,
  cta,
  highlight = false,
  badge
}: {
  name: string;
  price: string;
  period: string;
  desc: string;
  features: string[];
  cta: string;
  highlight?: boolean;
  badge?: string;
}) {
  return (
    <div
      className={`relative flex flex-col rounded-3xl border p-8 ${
        highlight
          ? "border-bloom-300 bg-gradient-to-b from-bloom-50 to-white shadow-lg shadow-bloom-500/10"
          : "border-black/10 bg-white"
      }`}
    >
      {badge && (
        <span className="absolute -top-3 left-8 rounded-full bg-bloom-500 px-3 py-1 text-xs font-semibold text-white">
          {badge}
        </span>
      )}
      <h3 className="font-display text-xl font-semibold text-ink">{name}</h3>
      <p className="mt-1 text-sm text-ink/60">{desc}</p>
      <div className="mt-5 flex items-baseline gap-1">
        <span className="font-display text-4xl font-semibold text-ink">{price}</span>
        <span className="text-sm text-ink/50">{period}</span>
      </div>
      <ul className="mt-6 flex-1 space-y-3 text-sm text-ink/80">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-bloom-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 010 1.4l-7.4 7.4a1 1 0 01-1.4 0L3.3 9.5a1 1 0 111.4-1.4l3.9 3.9 6.7-6.7a1 1 0 011.4 0z"
                clipRule="evenodd"
              />
            </svg>
            {f}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={highlight ? "btn-primary mt-8 w-full" : "btn-secondary mt-8 w-full"}
      >
        {cta}
      </button>
    </div>
  );
}
