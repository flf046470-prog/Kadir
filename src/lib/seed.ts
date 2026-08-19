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
