import "server-only";

import { getDb } from "./db";

/**
 * Starter content. Every phase begins at its true state — planning — so the
 * site never ships with progress that has not happened.
 */
const STORY_SECTIONS = [
  {
    slug: "the-idea",
    kicker: "01 — The idea",
    heading: "It started with a hole in the ground",
    body: `The idea behind Patagonia Underground is simple enough to draw on a napkin: build a house into the earth instead of on top of it, in a place where the land is worth more than anything you could put on it.

Not a bunker. Not a novelty. A real home with a meadow on its roof, a glazed dome over its centre, and one open face looking west at the Andes — warm in winter without working for it, cool in summer without a machine.

That is where this project is today: an idea, drawn, and not yet built.`,
  },
  {
    slug: "why-patagonia",
    kicker: "02 — Why here",
    heading: "Why Trevelin, and not anywhere else",
    body: `Trevelin is a small town in the Futaleufú Department of Chubut, in the Andean west of Argentine Patagonia. It was founded by Welsh settlers who crossed the continent from the Atlantic coast, and it still carries their language in its name: tre, town, and felin, mill — the town of the mill.

West of the town the cordillera climbs toward the Chilean border. North-west lies Los Alerces National Park, a UNESCO World Heritage site protecting alerce trees that were already ancient when the Welsh arrived. Between them are river valleys, poplar windbreaks, cattle, and long empty roads.

It is also a place with a climate that argues for this kind of building: cold clear winters, dry summers, and a west wind that never really stops. Earth is the cheapest insulation there is, and here it is the obvious one.`,
  },
  {
    slug: "the-vision",
    kicker: "03 — The vision",
    heading: "A house you have to look twice to find",
    body: `From the ridge above, the intention is that you see grass, rock, and a low dome of glass — and only then realise there is a house under it.

Inside, the opposite: a circular plan around a daylit courtyard, a long open living space, bedrooms set into the earth, and a wall of glazing facing the valley. Stone, concrete, wood, and light.

The point is not to hide. The point is to take up as little of the view as a building possibly can, and to give back everything above the roofline to the meadow that was already there.`,
  },
  {
    slug: "building-in-public",
    kicker: "04 — Building in public",
    heading: "Everything gets published — including the parts that go wrong",
    body: `Most projects only show you the finished photograph. This one is being published from the other end: from the stage where nothing exists yet.

Every phase on this site carries its real status. Nothing is marked complete before it is complete. There are no budget figures here yet, because no quote has been signed. There are no site photographs yet, because there is no site work to photograph. When those things exist, they will appear with their dates.

If a permit takes eight months instead of three, that will be written down too. Building in public is only worth anything if the difficult parts are included.`,
  },
  {
    slug: "the-future",
    kicker: "05 — The future",
    heading: "One day, someone else wakes up here",
    body: `The long-term intention is that this house becomes a place to stay: one property, a handful of guests at a time, in a valley most people have never heard of.

That is years away, and it depends on everything in between — permits, engineering, weather, money, and whether the thing can actually be built the way it has been drawn.

There is nothing to book and nothing to pay for. There is only a list of people who want to watch it happen, and an open invitation to be on it.`,
  },
];

const PHASES = [
  {
    slug: "idea",
    name: "Idea",
    description:
      "The concept: an earth-sheltered house in the Andean west of Chubut, with a planted roof and a daylit central courtyard.",
    status: "completed",
    date_label: "Completed",
    progress: 100,
  },
  {
    slug: "planning",
    name: "Planning",
    description:
      "Site research, feasibility, access and services, and the technical questions specific to building into a slope: drainage, waterproofing, and the structural load of the soil cover.",
    status: "in_progress",
    date_label: "In progress",
    progress: 0,
  },
  {
    slug: "design",
    name: "Design",
    description:
      "Moving from concept sketches to engineered architectural drawings that a builder in Chubut can price and construct.",
    status: "not_started",
    date_label: "Not started",
    progress: 0,
  },
  {
    slug: "preparation",
    name: "Preparation",
    description:
      "Permits, surveys, contractor selection, and site access. Nothing is dug before this phase is closed.",
    status: "not_started",
    date_label: "Not started",
    progress: 0,
  },
  {
    slug: "construction",
    name: "Construction",
    description:
      "Excavation, retaining structure, waterproofing and drainage, the dome, and the return of the soil cover over the roof.",
    status: "not_started",
    date_label: "Not started",
    progress: 0,
  },
  {
    slug: "interior",
    name: "Interior",
    description: "Fit-out, services, finishes, and everything that makes the shell habitable.",
    status: "not_started",
    date_label: "Not started",
    progress: 0,
  },
  {
    slug: "opening",
    name: "Opening",
    description:
      "The house complete and, eventually, open to the people who followed it from the beginning.",
    status: "not_started",
    date_label: "Not started",
    progress: 0,
  },
];


/*
 * The project's own concept visualisations, supplied by the owner and shipped
 * with the site. Every one of them is a render or a drawing — nothing here is
 * a photograph, nothing here is built — and each caption says which it is, so
 * the gallery can never be mistaken for a record of something that exists.
 */
const GALLERY: {
  file: string;
  subject: string;
  title: string;
  description: string;
  width: number;
  height: number;
}[] = [
  {
    file: "/project/exterior-night.webp",
    subject: "Exterior — night",
    title: "The house from the approach",
    description:
      "The glazed face and the courtyard dome seen from the fire pit below. The roof is the meadow: from this angle the building is a curve in the hillside.",
    width: 996,
    height: 604,
  },
  {
    file: "/project/exterior-dusk.webp",
    subject: "Exterior — dusk",
    title: "Dusk over the shoulder",
    description: "The same ground at last light, looking toward the range in the south-west.",
    width: 284,
    height: 406,
  },
  {
    file: "/project/living-room.webp",
    subject: "Living room",
    title: "Under the dome",
    description:
      "The main room sits below the eight-metre courtyard dome, with the hearth against the buried wall.",
    width: 532,
    height: 344,
  },
  {
    file: "/project/interior-dining.webp",
    subject: "Dining and kitchen",
    title: "Kitchen and table",
    description: "Kitchen and dining share one 28 m² space on the daylight side of the plan.",
    width: 296,
    height: 152,
  },
  {
    file: "/project/bedroom-spa.webp",
    subject: "Bedroom",
    title: "A bedroom and the water",
    description: "One of three bedrooms, opening to the courtyard through the inner glazing.",
    width: 532,
    height: 262,
  },
  {
    file: "/project/interior-bedroom.webp",
    subject: "Bathroom",
    title: "Bath under the dome",
    description: "The bath sits where the dome light reaches, against the earth wall.",
    width: 296,
    height: 156,
  },
  {
    file: "/project/site-plan.webp",
    subject: "Site plan",
    title: "One hectare, and where the house sits on it",
    description:
      "The plot is 100 by 100 metres. House, viewing terrace, fire pit, parking and the track in — drawn to show the arrangement, not surveyed positions.",
    width: 736,
    height: 636,
  },
  {
    file: "/project/floor-plan.webp",
    subject: "Floor plan",
    title: "Ground floor — 250 m²",
    description:
      "Twenty-two metres across: entrance, living room, kitchen and dining, three bedrooms, two bathrooms, utility, plant and the courtyard under the dome.",
    width: 470,
    height: 512,
  },
  {
    file: "/project/floor-plan-annotated.webp",
    subject: "Floor plan — annotated",
    title: "The plan, room by room",
    description: "The same plan with every room numbered against the schedule.",
    width: 492,
    height: 406,
  },
  {
    file: "/project/section.webp",
    subject: "Section",
    title: "Section A–A",
    description:
      "Through the dome and down: 80 to 100 cm of soil, waterproofing, XPS insulation, a 25 cm reinforced concrete wall, drainage board and pipe, raft foundation.",
    width: 478,
    height: 284,
  },
  {
    file: "/project/section-cutaway.webp",
    subject: "Section — cutaway",
    title: "The shell, opened",
    description: "The same construction shown as a cutaway rather than a flat section.",
    width: 478,
    height: 238,
  },
  {
    file: "/project/section-annotated.webp",
    subject: "Section — annotated",
    title: "The layers, named",
    description:
      "Soil cover, waterproofing, thermal insulation, the retaining wall, drainage and the raft — the parts the planning phase is working through now.",
    width: 486,
    height: 406,
  },
  {
    file: "/project/smart-home.webp",
    subject: "Systems",
    title: "House systems, as intended",
    description:
      "A concept for how lighting, climate, water and blinds would be controlled. No system is installed; this is a design intention.",
    width: 234,
    height: 406,
  },
];

export function seedIfEmpty(): void {
  const db = getDb();

  const storyCount = (
    db.prepare("SELECT COUNT(*) AS c FROM story_sections").get() as { c: number }
  ).c;
  if (storyCount === 0) {
    const stmt = db.prepare(
      "INSERT INTO story_sections (slug, kicker, heading, body, sort_order) VALUES (?, ?, ?, ?, ?)",
    );
    db.transaction(() => {
      STORY_SECTIONS.forEach((s, i) => stmt.run(s.slug, s.kicker, s.heading, s.body, i));
    })();
  }

  const galleryCount = (
    db.prepare("SELECT COUNT(*) AS c FROM gallery_images").get() as { c: number }
  ).c;
  if (galleryCount === 0) {
    const stmt = db.prepare(
      `INSERT INTO gallery_images (file_path, title, description, location, photographer,
         source_url, license, category, season, subject, alt_text, width, height, sort_order, published)
       VALUES (?, ?, ?, ?, ?, '', ?, 'project', '', ?, ?, ?, ?, ?, 1)`,
    );
    db.transaction(() => {
      GALLERY.forEach((image, i) =>
        stmt.run(
          image.file,
          image.title,
          image.description,
          "Trevelin · Chubut · Argentina",
          "Patagonia Underground",
          "Project concept visualisation — not a photograph",
          image.subject,
          `${image.subject}: ${image.title}. Concept visualisation of the project; nothing is built yet.`,
          image.width,
          image.height,
          i,
        ),
      );
    })();
  }

  const phaseCount = (
    db.prepare("SELECT COUNT(*) AS c FROM progress_phases").get() as { c: number }
  ).c;
  if (phaseCount === 0) {
    const stmt = db.prepare(
      `INSERT INTO progress_phases (slug, name, description, status, date_label, progress, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    db.transaction(() => {
      PHASES.forEach((p, i) =>
        stmt.run(p.slug, p.name, p.description, p.status, p.date_label, p.progress, i),
      );
    })();
  }
}
