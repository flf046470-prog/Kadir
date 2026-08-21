import Image from "next/image";
import type { ReactNode } from "react";
import { CutDrawing } from "./drawings";

/**
 * The narrative spine of the home page: one image held on screen while the
 * text walks past it, changing as each step arrives.
 *
 * The markup is plain and server-rendered. <ScrollMotion /> reads the
 * `data-story-*` hooks and crossfades the stage; with no JavaScript, or with
 * reduced motion, the stage is hidden and each step shows its own visual
 * inline instead — which is also the layout on narrow screens.
 */

type Step = {
  index: string;
  title: string;
  body: string;
  caption: string;
  visual: ReactNode;
};

/** A supplied view. `contain` for drawings, `cover` for the rendered views. */
function Frame({
  src,
  alt,
  fit = "cover",
}: {
  src: string;
  alt: string;
  fit?: "cover" | "contain";
}) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-stone/40">
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 1024px) 100vw, 46vw"
        loading="lazy"
        className={fit === "cover" ? "object-cover" : "object-contain"}
      />
    </div>
  );
}

export function StorySequence() {
  const steps: Step[] = [
    {
      index: "01",
      title: "A valley with a wall on one side",
      body:
        "Trevelin sits east of the cordillera, in the Futaleufú department of Chubut. The range holds the weather; below it the land runs down to water and farmland. This is the ground the project starts from.",
      caption: "The Andes and the lagoon, south-west of the plot — concept visualisation",
      visual: (
        <Frame
          src="/project/andes-view.webp"
          alt="The Andes range beyond a lagoon and wooded valley, south-west of the site. Concept visualisation."
        />
      ),
    },
    {
      index: "02",
      title: "One hectare, and one decision",
      body:
        "The plot is a hundred metres square. Almost all of it stays as it is: the house, a viewing terrace, a fire pit and a parking bay sit on a small part of it, reached by a single track. Where those sit relative to each other is the design; the surveyed position on the ground is not published yet.",
      caption: "Site plan — arrangement, not survey data",
      visual: (
        <Frame
          src="/project/site-plan.webp"
          alt="Site plan of the one-hectare plot showing the underground house, viewing terrace, fire pit, parking and access track."
          fit="contain"
        />
      ),
    },
    {
      index: "03",
      title: "Cut, not placed",
      body:
        "The house goes into the slope rather than onto it. The ground is opened, the shell is built inside the cut, and the meadow is put back over the roof. What is left above ground is a curve in the grass, a dome over the courtyard, and one face of glass.",
      caption: "The principle, drawn in one line",
      visual: <CutDrawing className="h-full w-full" />,
    },
    {
      index: "04",
      title: "One room, facing the light",
      body:
        "Twenty-two metres across, 250 m² inside: living room, kitchen and dining on the daylight side, three bedrooms and two bathrooms around the ring, utility and plant against the earth wall, and a courtyard under the dome holding the middle.",
      caption: "Ground floor — concept plan, not construction documents",
      visual: (
        <Frame
          src="/project/floor-plan.webp"
          alt="Ground floor plan: a circular house 22 metres across with entrance, living room, kitchen and dining, three bedrooms, two bathrooms, utility, plant room and a central courtyard under the dome."
          fit="contain"
        />
      ),
    },
    {
      index: "05",
      title: "The hard part is the section",
      body:
        "The shape is the easy question. The difficult ones — waterproofing, drainage, and the weight of wet soil on a roof — are answered in section: 80 to 100 cm of cover, membrane, insulation, a 25 cm retaining wall, drainage board and pipe, and a raft under all of it. That is what the planning phase is working through now.",
      caption: "Section A–A — principle, not engineering drawings",
      visual: (
        <Frame
          src="/project/section.webp"
          alt="Section through the house showing the soil cover, waterproofing, insulation, reinforced concrete retaining wall, drainage and raft foundation."
          fit="contain"
        />
      ),
    },
    {
      index: "06",
      title: "At night, almost nothing",
      body:
        "From the approach there is no building to see: a hillside, a lit dome in the grass, and one band of warm light where the glass meets the slope. That restraint is the whole argument — a house that takes almost nothing from the view it was built for.",
      caption: "Exterior at night — concept visualisation, nothing is built yet",
      visual: (
        <Frame
          src="/project/exterior-night.webp"
          alt="The house at night: a glazed façade curving into the hillside, a lit glass dome above the courtyard, and a fire pit on the terrace below."
        />
      ),
    },
  ];

  return (
    <section
      data-motion="story"
      aria-label="The project, step by step"
      className="relative border-y border-fog/10 bg-loam/30 py-20 md:py-28"
    >
      <div className="shell">
        <div className="grid gap-x-16 lg:grid-cols-[1.15fr_1fr]">
          {/* The stage: held in place while the steps scroll past it. */}
          <div
            data-story-stage
            className="pointer-events-none sticky top-24 hidden h-[70vh] lg:block"
          >
            <div className="relative h-full w-full">
              {steps.map((step, i) => (
                <figure
                  key={step.index}
                  data-story-visual={i}
                  className="absolute inset-0 flex flex-col"
                  style={{ opacity: i === 0 ? 1 : 0 }}
                >
                  <div className="relative min-h-0 flex-1 [&>svg]:h-full [&>svg]:w-full">
                    {step.visual}
                  </div>
                  <figcaption className="label mt-5 shrink-0 text-fog/50">{step.caption}</figcaption>
                </figure>
              ))}
            </div>
          </div>

          {/* The steps. */}
          <div>
            {steps.map((step, i) => (
              <article
                key={step.index}
                data-story-step={i}
                className="flex min-h-[62vh] flex-col justify-center py-10 lg:py-16"
              >
                <p className="label text-ember">{step.index}</p>
                <h2 className="mt-4 max-w-lg font-display text-[1.9rem] leading-[1.15] md:text-4xl">
                  {step.title}
                </h2>
                <p className="prose-valley mt-5 max-w-lg text-fog">{step.body}</p>

                {/* On narrow screens the visual belongs with its own step. */}
                <figure data-story-inline className="mt-8 lg:hidden">
                  <div className="relative aspect-[4/3] w-full [&>svg]:h-full [&>svg]:w-full">
                    {step.visual}
                  </div>
                  <figcaption className="label mt-4 text-fog/50">{step.caption}</figcaption>
                </figure>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
