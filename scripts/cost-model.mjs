import { readFileSync } from "node:fs";

/**
 * The financial model (§47, §48).
 *
 * A script rather than a table, because §48 asks for a model whose ratios can
 * be changed. Every assumption below is a named constant; change one and re-run.
 *
 *   node scripts/cost-model.mjs
 *   node scripts/cost-model.mjs --paying 0.03 --vip 0.2
 *
 * **On the prices.** §47 is explicit: do not assume a price is current. So each
 * one carries where it came from and when it was checked, and anything that
 * could not be verified against a primary source is marked `estimate` and
 * printed with a warning. An unsourced number that looks authoritative is worse
 * than an obvious guess, because nobody re-checks it.
 *
 * The two prices that dominate the answer — the store commissions — were
 * verified. Most of the infrastructure lines were not: their vendors' pricing
 * pages render in the browser and could not be read directly. Treat every
 * `estimate` as a placeholder to replace before this model decides anything.
 */

const TODAY = "2026-09-05";

/** Revenue assumptions. §48's defaults; override on the command line. */
const ASSUMPTIONS = {
  /** Share of all members who pay anything. */
  payingShare: 0.05,
  /** Of the paying members, the share on PLUS; the rest are VIP. */
  plusShareOfPaying: 0.7,
  /**
   * Share of members active in a given month. Costs that scale with *use* —
   * translation, bandwidth, voice — scale with this rather than with signups,
   * and a model that ignores it overstates cost by roughly 4x at every scale.
   */
  monthlyActiveShare: 0.25,
  /** Translations per active member per month. Free tier caps at 15/day. */
  translationsPerActiveMonth: 40,
  /** Virtual date minutes per active member per month, once VR exists. */
  virtualDateMinutesPerActiveMonth: 20,
  /** Corporate tax on profit. Turkey's headline rate. */
  taxRate: 0.25
};

const SCALES = [10_000, 100_000, 1_000_000, 10_000_000];

/**
 * Prices, each with its provenance. `verified` means a primary source was read
 * on `checkedOn`; everything else is an order-of-magnitude placeholder.
 */
const PRICES = {
  appleCommission: {
    value: 0.15,
    unit: "share of gross",
    verified: true,
    checkedOn: TODAY,
    source: "developer.apple.com/app-store/small-business-program/",
    note: "Small Business Program: 15% for proceeds up to $1M in the prior calendar year. Above that the standard rate applies and this model understates fees."
  },
  googleCommission: {
    value: 0.15,
    unit: "share of gross",
    verified: true,
    checkedOn: TODAY,
    source: "support.google.com/googleplay/android-developer/answer/112622",
    note: "15% on auto-renewing subscriptions regardless of annual revenue."
  },

  // ---- infrastructure, all unverified ----
  serverPerMonth: {
    value: 5,
    unit: "USD per app instance per month",
    verified: false,
    source: "Hetzner CX-class shared vCPU, order of magnitude",
    note: "One instance per 25k monthly-active members is the scaling rule below."
  },
  databasePerMonth: {
    value: 20,
    unit: "USD per month at 10k members, scaling sublinearly",
    verified: false,
    source: "managed Postgres, order of magnitude"
  },
  bandwidthPerGb: {
    value: 0.01,
    unit: "USD per GB egress",
    verified: false,
    source: "Hetzner/Cloudflare class egress; hyperscalers are ~10x this"
  },
  storagePerGbMonth: {
    value: 0.015,
    unit: "USD per GB per month",
    verified: false,
    source: "S3-compatible object storage, order of magnitude"
  },
  translationPerMillionChars: {
    value: 20,
    unit: "USD per million characters",
    verified: false,
    source: "DeepL API Pro class pricing; page not machine-readable"
  },
  voicePerMinute: {
    value: 0.0015,
    unit: "USD per participant-minute",
    verified: false,
    source: "hosted spatial-voice providers, order of magnitude",
    note: "PROVIDER NOT CHOSEN. See docs/VOICE.md — this line is a placeholder for a decision nobody has made."
  },
  multiplayerPerMinute: {
    value: 0.001,
    unit: "USD per participant-minute",
    verified: false,
    source: "hosted realtime/relay providers, order of magnitude",
    note: "PROVIDER NOT CHOSEN. See docs/MULTIPLAYER.md."
  },
  monitoringPerMonth: {
    value: 0,
    unit: "USD per month",
    verified: true,
    checkedOn: TODAY,
    source: "this repository",
    note: "Nothing is wired. Real, and a gap rather than a saving — see DEPLOYMENT.md."
  },
  emailPerThousand: {
    value: 0.5,
    unit: "USD per thousand emails",
    verified: false,
    source: "transactional email providers, order of magnitude"
  },
  pushPerMillion: {
    value: 0,
    unit: "USD per million notifications",
    verified: true,
    checkedOn: TODAY,
    source: "APNs and FCM are free to send",
    note: "The cost of push is the infrastructure that decides what to send, not delivery."
  }
};

/** Annual prices, read from the code so the model cannot disagree with the app. */
function tierPrices() {
  const source = readFileSync(new URL("../src/lib/billing/tiers.ts", import.meta.url), "utf8");
  const block = source.match(/ANNUAL_PRICE_CENTS[^{]*\{([^}]*)\}/s)?.[1] ?? "";
  const read = (tier) => Number(block.match(new RegExp(`${tier}:\\s*(\\d+)`))?.[1] ?? 0) / 100;
  return { plus: read("plus"), vip: read("vip") };
}

function model(users, assumptions, prices, tiers) {
  const paying = users * assumptions.payingShare;
  const plus = paying * assumptions.plusShareOfPaying;
  const vip = paying - plus;
  const active = users * assumptions.monthlyActiveShare;

  const grossAnnual = plus * tiers.plus + vip * tiers.vip;

  /**
   * One blended commission rate. The split between stores is unknown before
   * launch, and both verified rates are 15%, so a blend adds false precision.
   */
  const storeFees = grossAnnual * prices.appleCommission.value;
  const netRevenue = grossAnnual - storeFees;

  // Costs are monthly, then annualised.
  const instances = Math.max(1, Math.ceil(active / 25_000));
  const gbEgressPerActive = 0.4; // photos dominate; they are WebP and capped at 6
  const gbStoredPerMember = 0.01; // ~6 photos, re-encoded

  const monthly = {
    server: instances * prices.serverPerMonth.value,
    // Sublinear: a managed instance handles a lot before it needs a bigger one.
    database: prices.databasePerMonth.value * Math.sqrt(users / 10_000),
    bandwidth: active * gbEgressPerActive * prices.bandwidthPerGb.value,
    storage: users * gbStoredPerMember * prices.storagePerGbMonth.value,
    translation:
      (active * assumptions.translationsPerActiveMonth * 120) /
      1_000_000 *
      prices.translationPerMillionChars.value,
    voice:
      active *
      assumptions.virtualDateMinutesPerActiveMonth *
      2 *
      prices.voicePerMinute.value,
    multiplayer:
      active *
      assumptions.virtualDateMinutesPerActiveMonth *
      2 *
      prices.multiplayerPerMinute.value,
    cdn: 0,
    monitoring: prices.monitoringPerMonth.value,
    notifications: 0,
    email: (users / 1000) * prices.emailPerThousand.value
  };

  const costAnnual = Object.values(monthly).reduce((a, b) => a + b, 0) * 12;
  const profitBeforeTax = netRevenue - costAnnual;
  const tax = profitBeforeTax > 0 ? profitBeforeTax * assumptions.taxRate : 0;

  return {
    users,
    paying,
    plus,
    vip,
    active,
    grossAnnual,
    storeFees,
    netRevenue,
    monthly,
    costAnnual,
    profitBeforeTax,
    tax,
    profitAfterTax: profitBeforeTax - tax
  };
}

// ---- output ----

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};

const assumptions = {
  ...ASSUMPTIONS,
  payingShare: flag("paying", ASSUMPTIONS.payingShare),
  plusShareOfPaying: flag("plus", ASSUMPTIONS.plusShareOfPaying),
  monthlyActiveShare: flag("active", ASSUMPTIONS.monthlyActiveShare),
  taxRate: flag("tax", ASSUMPTIONS.taxRate)
};

const tiers = tierPrices();
const usd = (n) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : n >= 1000
      ? `$${(n / 1000).toFixed(1)}k`
      : `$${n.toFixed(0)}`;

console.log(`\nFioreMatch financial model — ${TODAY}\n`);
console.log("Assumptions");
console.log(`  paying members          ${(assumptions.payingShare * 100).toFixed(1)}%`);
console.log(
  `  of those, PLUS / VIP    ${(assumptions.plusShareOfPaying * 100).toFixed(0)}% / ${((1 - assumptions.plusShareOfPaying) * 100).toFixed(0)}%`
);
console.log(`  monthly active          ${(assumptions.monthlyActiveShare * 100).toFixed(0)}%`);
console.log(`  PLUS / VIP price        $${tiers.plus} / $${tiers.vip} per year`);
console.log(`  store commission        ${(PRICES.appleCommission.value * 100).toFixed(0)}%`);
console.log(`  tax on profit           ${(assumptions.taxRate * 100).toFixed(0)}%\n`);

const rows = SCALES.map((n) => model(n, assumptions, PRICES, tiers));
const LINES = Object.keys(rows[0].monthly);

const col = (s) => String(s).padStart(12);
console.log("Annual".padEnd(24) + SCALES.map((n) => col(n.toLocaleString())).join(""));
console.log("-".repeat(24 + 12 * SCALES.length));
console.log("  paying members".padEnd(24) + rows.map((r) => col(Math.round(r.paying).toLocaleString())).join(""));
console.log("  gross revenue".padEnd(24) + rows.map((r) => col(usd(r.grossAnnual))).join(""));
console.log("  store fees".padEnd(24) + rows.map((r) => col("-" + usd(r.storeFees))).join(""));
console.log("  net revenue".padEnd(24) + rows.map((r) => col(usd(r.netRevenue))).join(""));
console.log();
console.log("Costs (annual)".padEnd(24) + SCALES.map(() => col("")).join(""));
for (const line of LINES) {
  const values = rows.map((r) => col(usd(r.monthly[line] * 12)));
  console.log(`  ${line}`.padEnd(24) + values.join(""));
}
console.log("-".repeat(24 + 12 * SCALES.length));
console.log("  total cost".padEnd(24) + rows.map((r) => col(usd(r.costAnnual))).join(""));
console.log("  profit before tax".padEnd(24) + rows.map((r) => col(usd(r.profitBeforeTax))).join(""));
console.log("  tax".padEnd(24) + rows.map((r) => col("-" + usd(r.tax))).join(""));
console.log("  profit after tax".padEnd(24) + rows.map((r) => col(usd(r.profitAfterTax))).join(""));
console.log(
  "  margin".padEnd(24) +
    rows.map((r) => col(`${((r.profitAfterTax / r.netRevenue) * 100).toFixed(0)}%`)).join("")
);

const unverified = Object.entries(PRICES).filter(([, p]) => !p.verified);
console.log(`\n${unverified.length} of ${Object.keys(PRICES).length} prices are UNVERIFIED estimates:\n`);
for (const [name, price] of unverified) {
  console.log(`  ${name.padEnd(28)} ${price.value} ${price.unit}`);
  console.log(`  ${"".padEnd(28)} ${price.source}`);
  if (price.note) console.log(`  ${"".padEnd(28)} ${price.note}`);
}
console.log(
  "\nVerified against a primary source today: store commissions only.\n" +
    "Replace the estimates with quotes before this model decides anything.\n"
);
