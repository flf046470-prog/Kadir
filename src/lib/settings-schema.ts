/**
 * Every string on the public site that is not a database row lives here.
 * The admin panel renders this registry, so adding a key here makes it
 * editable without touching the admin UI.
 */
export type SettingField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "url" | "longtext";
  group: SettingGroup;
  help?: string;
  default: string;
};

export type SettingGroup =
  | "brand"
  | "project"
  | "transparency"
  | "community"
  | "stay"
  | "location"
  | "social"
  | "seo";

export const SETTING_GROUP_LABELS: Record<SettingGroup, string> = {
  brand: "Brand & hero",
  project: "Project page",
  transparency: "Transparency",
  community: "Email community",
  stay: "Future stay",
  location: "Location",
  social: "Social media",
  seo: "SEO & sharing",
};

export const SETTINGS: SettingField[] = [
  // ── Brand & hero ─────────────────────────────────────────────────────────
  {
    key: "brand.projectName",
    label: "Project name",
    type: "text",
    group: "brand",
    default: "Patagonia Underground",
  },
  {
    key: "brand.heroLine",
    label: "Hero line",
    type: "text",
    group: "brand",
    default: "A project taking shape beneath the wild landscapes of Patagonia.",
  },
  {
    key: "brand.heroIntro",
    label: "Hero intro",
    type: "textarea",
    group: "brand",
    default:
      "An earth-sheltered house is being planned above the Percy valley, in Trevelin — a Welsh-founded town in the Argentine Andes. Nothing is built yet. This site follows the project from the first sketch onward, in public.",
  },
  {
    key: "brand.locationLabel",
    label: "Location strip",
    type: "text",
    group: "brand",
    default: "Trevelin · Chubut · Patagonia · Argentina",
  },
  {
    key: "brand.statusLabel",
    label: "Public status label",
    type: "text",
    group: "brand",
    help: "Shown in the status pill across the site. Keep it truthful.",
    default: "Planning stage",
  },
  {
    key: "brand.statusNote",
    label: "Status note",
    type: "textarea",
    group: "brand",
    default:
      "No construction has started. The project is in planning and early design.",
  },

  // ── Project page ─────────────────────────────────────────────────────────
  {
    key: "project.intro",
    label: "Intro",
    type: "textarea",
    group: "project",
    default:
      "Patagonia Underground is a plan for a single home built into the ground rather than on top of it: an earth-sheltered dwelling that keeps the meadow above it intact, lit from a central glazed dome and opened to the Andes on one side.",
  },
  {
    key: "project.purpose",
    label: "The purpose",
    type: "longtext",
    group: "project",
    default:
      "The purpose is not to add another building to a landscape that does not need one. It is to test whether a house can be almost invisible from the outside and still be full of light inside — and to document honestly what that takes: the excavation, the waterproofing, the drainage, the cost, the mistakes.\n\nIf it works, it becomes a place other people can one day stay in. If parts of it do not work, that will be published too.",
  },
  {
    key: "project.whyPatagonia",
    label: "Why Patagonia",
    type: "longtext",
    group: "project",
    default:
      "Trevelin sits where the Andes stop being a wall and start being a valley. The town was founded by Welsh settlers of Y Wladfa and named in their language — tre (town) and felin (mill), the town of the mill. West of it the cordillera rises toward the Chilean border; north-west lies Los Alerces National Park, a UNESCO World Heritage site protecting alerce trees older than most cities.\n\nIt is a place with weather worth building against: cold, clear winters, long dry summers, wind that arrives from the west. Earth-sheltered building is a direct answer to exactly that climate.",
  },
  {
    key: "project.architecture",
    label: "The architectural idea",
    type: "longtext",
    group: "project",
    default:
      "The working concept is a single-storey circular plan of roughly 250 m², set into a slope. Reinforced concrete retaining walls hold the earth back; 80–100 cm of soil is returned over the roof so the meadow continues across it. A glazed dome over a central courtyard brings daylight into the middle of the plan, while the downhill face opens fully to the valley.\n\nThe concept currently allows for three bedrooms, two bathrooms, an open kitchen and living space, technical and storage rooms, and covered parking. Every number here is a design intention, not a finished drawing — the concept will change as engineering begins, and the changes will be published.",
  },
  {
    key: "project.nature",
    label: "Relationship with nature",
    type: "longtext",
    group: "project",
    default:
      "Building into the ground is a thermal decision before it is an aesthetic one. Soil holds temperature: a buried envelope swings far less between a Patagonian August night and a February afternoon, which means less heating, less cooling, and less equipment.\n\nThe surface consequence matters just as much. The roof stays a meadow. Rainwater is collected rather than shed. Excavated material is reused on site instead of trucked away. From the ridge above, the house should read as a dome in the grass and nothing more.",
  },
  {
    key: "project.stayConcept",
    label: "Future accommodation concept",
    type: "longtext",
    group: "project",
    default:
      "The long-term intention is that this house becomes a place to stay — a small, single-property retreat rather than a hotel. There are no rooms to book, no dates, no prices, and no reservation system, because there is no building yet.\n\nWhat exists today is the intention, stated openly so that the people following the project know where it is going.",
  },
  {
    key: "project.currentStatus",
    label: "Where the project stands today",
    type: "longtext",
    group: "project",
    default:
      "Planning and early design. Site research, the architectural concept, and the technical questions that come with an earth-sheltered structure — drainage, waterproofing, structural loading of the soil cover, permits.\n\nNo ground has been broken. No permits have been granted. No contractor has been appointed.",
  },
  {
    key: "project.nextSteps",
    label: "What comes next",
    type: "longtext",
    group: "project",
    default:
      "Confirming the site and its access, moving from concept to engineered drawings, and understanding the permit path in Chubut for a partially buried structure. Each of those steps will appear on the transparency page with a date when it actually happens.",
  },

  // ── Transparency ─────────────────────────────────────────────────────────
  {
    key: "transparency.intro",
    label: "Intro",
    type: "textarea",
    group: "transparency",
    default:
      "This page is the project's record. It shows what stage the project is really in, what has been finished, and what has not been started. Nothing on it is rounded up.",
  },
  {
    key: "transparency.finance",
    label: "Financial disclosure",
    type: "longtext",
    group: "transparency",
    default:
      "Project financial information will be shared progressively as the project develops. No budget figures, cost estimates, or funding numbers are published here yet, because none of them have been confirmed. When real quotes and real invoices exist, they will appear on this page with their dates.",
  },
  {
    key: "transparency.commitments",
    label: "Commitments",
    type: "longtext",
    group: "transparency",
    default:
      "No fake progress. A phase is only marked complete when it is complete.\nNo fake photography. Project images are labelled with what they are — site photograph, concept illustration, or reference.\nNo fake numbers. No budgets, timelines, or percentages that have not been confirmed.\nNo fake reviews, bookings, awards, or partnerships. There are no guests yet, so there is nothing to quote.\nDelays get published. If something slips, the date on this page moves and the reason is written down.",
  },

  // ── Community ────────────────────────────────────────────────────────────
  {
    key: "community.headline",
    label: "Headline",
    type: "text",
    group: "community",
    default: "Follow Patagonia Underground",
  },
  {
    key: "community.subtext",
    label: "Sub-text",
    type: "textarea",
    group: "community",
    default:
      "Follow the project from the beginning and be among the first to know when Patagonia Underground comes to life.",
  },
  {
    key: "community.successMessage",
    label: "Success message",
    type: "textarea",
    group: "community",
    default:
      "You're in. We'll keep you updated as Patagonia Underground takes shape.",
  },
  {
    key: "community.privacyNote",
    label: "Privacy note",
    type: "textarea",
    group: "community",
    default:
      "Your address is used for project updates only. No selling, no sharing, no third-party marketing. One click unsubscribes you.",
  },

  // ── Future stay ──────────────────────────────────────────────────────────
  {
    key: "stay.heading",
    label: "Heading",
    type: "text",
    group: "stay",
    default: "One day, stay in Patagonia",
  },
  {
    key: "stay.body",
    label: "Body",
    type: "textarea",
    group: "stay",
    default:
      "Patagonia Underground is being built with a future accommodation experience in mind. There is nothing to book yet — no rooms, no dates, no prices. The people on the update list will simply be the first to hear when that changes.",
  },

  // ── Location ─────────────────────────────────────────────────────────────
  {
    key: "location.intro",
    label: "Intro",
    type: "textarea",
    group: "location",
    default:
      "Trevelin lies in the Futaleufú Department of Chubut, in the Andean west of the province. It is a small town of Welsh origin surrounded by river valleys, poplar windbreaks, cattle fields and, a few kilometres west, the mountains that mark the Chilean border.",
  },
  {
    key: "location.plotNote",
    label: "Note about the plot",
    type: "textarea",
    group: "location",
    help: "Do not publish exact plot coordinates until you intend them to be public.",
    default:
      "The exact location of the plot is not published yet. The coordinates below are the town of Trevelin, for orientation only.",
  },
  {
    key: "location.coordinates",
    label: "Reference coordinates (town)",
    type: "text",
    group: "location",
    default: "43.09° S, 71.46° W — Trevelin town centre, approximate",
  },
  {
    key: "location.travelNotes",
    label: "Travel notes",
    type: "longtext",
    group: "location",
    help: "Verify distances and journey times before publishing anything specific.",
    default:
      "The nearest larger town is Esquel, roughly 25 km to the north, which has the closest airport (Esquel, EQS) and long-distance bus connections. Route 259 runs west from Trevelin toward the Futaleufú border crossing into Chile.\n\nExact distances, journey times and border opening hours change; check them at the time of travel rather than trusting a website.",
  },

  // ── Social ───────────────────────────────────────────────────────────────
  { key: "social.instagram", label: "Instagram URL", type: "url", group: "social", default: "" },
  { key: "social.tiktok", label: "TikTok URL", type: "url", group: "social", default: "" },
  { key: "social.youtube", label: "YouTube URL", type: "url", group: "social", default: "" },
  { key: "social.facebook", label: "Facebook URL", type: "url", group: "social", default: "" },
  { key: "social.x", label: "X URL", type: "url", group: "social", default: "" },
  {
    key: "social.note",
    label: "Social section note",
    type: "textarea",
    group: "social",
    default:
      "Photographs, short films and site updates are posted as the project moves. Leave a channel blank to hide it.",
  },

  // ── SEO ──────────────────────────────────────────────────────────────────
  {
    key: "seo.siteUrl",
    label: "Canonical site URL",
    type: "url",
    group: "seo",
    help: "Used for canonical tags, sitemap and Open Graph. Also settable with NEXT_PUBLIC_SITE_URL.",
    default: "",
  },
  {
    key: "seo.defaultTitle",
    label: "Default title",
    type: "text",
    group: "seo",
    default: "Patagonia Underground — an underground house taking shape in Trevelin, Patagonia",
  },
  {
    key: "seo.defaultDescription",
    label: "Default meta description",
    type: "textarea",
    group: "seo",
    default:
      "Follow Patagonia Underground: an earth-sheltered house being planned in Trevelin, Chubut, Argentine Patagonia. Real progress, published in public — no fake numbers, no bookings, just the journey.",
  },
];

export const SETTING_DEFAULTS: Record<string, string> = Object.fromEntries(
  SETTINGS.map((s) => [s.key, s.default]),
);
