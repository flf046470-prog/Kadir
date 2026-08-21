import type { ReactNode } from "react";
import { CrossSectionDiagram, OrientationMap } from "../visuals";
import { CutDrawing, FloorPlanDrawing, NightDrawing } from "./drawings";

/**
 * The narrative spine of the home page: one drawing held on screen while the
 * text walks past it, the drawing changing as each step arrives.
 *
 * The markup is plain and server-rendered. <ScrollMotion /> reads the
 * `data-story-*` hooks and crossfades the stage; with no JavaScript, or with
 * reduced motion, every step simply appears with its own drawing beneath it,
 * which is why each step carries its visual inline on narrow screens.
 */

type Step = {
  index: string;
  title: string;
  body: string;
  caption: string;
  visual: ReactNode;
};

export function StorySequence() {
  const steps: Step[] = [
    {
      index: "01",
      title: "A valley with a wall on one side",
      body:
        "Trevelin sits east of the cordillera, in the Futaleufú department of Chubut. The range holds the weather; the valley below it is farmland, poplar windbreaks and long gravel roads. This is the ground the project starts from — not a render of somewhere generic.",
      caption: "The valley, looking west toward the border range",
      visual: <OrientationMap className="h-full w-full" />,
    },
    {
      index: "02",
      title: "A shoulder above the road",
      body:
        "The site is a shelf on a slope, high enough to see down the valley and low enough to stay out of the wind. Its exact position is not published while the land questions are still being settled — a marked point on a public map is a decision, not a detail.",
      caption: "Orientation study — conceptual, not survey data",
      visual: <OrientationMap className="h-full w-full" />,
    },
    {
      index: "03",
      title: "Cut, not placed",
      body:
        "The house goes into the slope rather than onto it. The ground is opened, the shell is built inside the cut, and the meadow is put back over the roof. What is left above ground is a curve in the grass and one face of glass.",
      caption: "The principle, drawn in one line",
      visual: <CutDrawing className="h-full w-full" />,
    },
    {
      index: "04",
      title: "One room, facing the light",
      body:
        "The plan is a circle. Everything that needs daylight sits on the glazed arc; everything that does not — storage, plant, the buried side — takes the earth wall behind. A hearth holds the middle, which is how a house this shape stays warm without machinery.",
      caption: "Concept plan — not construction documents",
      visual: <FloorPlanDrawing className="h-full w-full" />,
    },
    {
      index: "05",
      title: "The hard part is the section",
      body:
        "The shape is the easy question. The difficult ones are waterproofing, drainage and the weight of wet soil on a roof, and they are answered in section, not in plan. This drawing shows the order of the layers, and the planning phase is working through each of them now.",
      caption: "Section through the shell — principle, not engineering",
      visual: <CrossSectionDiagram className="h-full w-full" />,
    },
    {
      index: "06",
      title: "At night, almost nothing",
      body:
        "From the valley floor there is no building to see: a hillside, and a band of warm light where the glass meets the slope. That restraint is the whole argument — a house that takes almost nothing from the view it was built for.",
      caption: "Night study — conceptual",
      visual: <NightDrawing className="h-full w-full" />,
    },
  ];

  return (
    <section
      data-motion="story"
      aria-label="The project, step by step"
      className="relative border-y border-fog/10 bg-loam/30 py-20 md:py-28"
    >
      <div className="shell">
        <div className="grid gap-x-16 lg:grid-cols-[1fr_1.05fr]">
          {/* The stage: held in place while the steps scroll past it. */}
          <div data-story-stage className="pointer-events-none sticky top-24 hidden h-[68vh] lg:block">
            <div className="relative h-full w-full">
              {steps.map((step, i) => (
                <figure
                  key={step.index}
                  data-story-visual={i}
                  className="absolute inset-0 flex flex-col justify-center"
                  style={{ opacity: i === 0 ? 1 : 0 }}
                >
                  <div className="min-h-0 flex-1 [&>svg]:h-full [&>svg]:w-full [&>svg]:object-contain">
                    {step.visual}
                  </div>
                  <figcaption className="label mt-6 shrink-0 text-fog/50">{step.caption}</figcaption>
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

                {/* On narrow screens the drawing belongs with its own step. */}
                <figure data-story-inline className="mt-8 lg:hidden">
                  <div className="[&>svg]:h-auto [&>svg]:w-full">{step.visual}</div>
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
