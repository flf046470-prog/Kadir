import type { Metadata } from "next";
import Image from "next/image";
import { Reveal } from "@/components/reveal";
import { CtaLink, EmptyState, PageHeader, SectionHeading } from "@/components/ui";
import { getGalleryImages, type GalleryImage } from "@/lib/content";
import { getPageContext } from "@/lib/page";
import { absoluteUrl } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { settings, path } = await getPageContext(params);
  const title = "Gallery — Trevelin and the project";
  const description =
    "Photographs of Trevelin and Patagonia, and images of the project itself. Every image is labelled with what it actually is, plus its photographer and licence.";
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl(path("/gallery"), settings) },
    openGraph: { title, description, url: absoluteUrl(path("/gallery"), settings) },
  };
}

const SEASONS = [
  { key: "summer", label: "Summer" },
  { key: "autumn", label: "Autumn" },
  { key: "winter", label: "Winter" },
  { key: "spring", label: "Spring" },
];

function ImageCard({ image }: { image: GalleryImage }) {
  const credit = [image.photographer, image.license].filter(Boolean).join(" · ");
  return (
    <figure className="card-stone group overflow-hidden">
      <div className="relative aspect-[4/3] overflow-hidden bg-stone">
        <Image
          src={image.file_path}
          alt={image.alt_text || image.title || "Gallery image"}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
          loading="lazy"
        />
      </div>
      <figcaption className="p-5">
        {image.title ? <p className="font-display text-lg text-snow">{image.title}</p> : null}
        {image.description ? (
          <p className="mt-2 text-sm leading-relaxed text-fog">{image.description}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1">
          {image.location ? <span className="label text-fog/60">{image.location}</span> : null}
          {image.season ? <span className="label text-ember">{image.season}</span> : null}
        </div>
        {credit ? <p className="mt-3 text-xs text-fog/50">{credit}</p> : null}
      </figcaption>
    </figure>
  );
}

export default async function GalleryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { t, path } = await getPageContext(params);
  const patagonia = getGalleryImages("patagonia");
  const project = getGalleryImages("project");

  return (
    <>
      <PageHeader
        kicker={t("nav.gallery")}
        title="Trevelin, and the project"
        intro="Two collections, kept apart on purpose: the region as it is, and the project as it actually exists. Nothing from one is presented as the other."
      />

      <div className="shell py-20 md:py-28">
        <section>
          <Reveal>
            <SectionHeading kicker="01 — Patagonia" title="Trevelin and the valleys around it" />
          </Reveal>
          <div className="mt-10">
            {patagonia.length > 0 ? (
              <>
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {patagonia.map((image, i) => (
                    <Reveal key={image.id} delay={i * 40}>
                      <ImageCard image={image} />
                    </Reveal>
                  ))}
                </div>
                <div className="mt-10 flex flex-wrap gap-2">
                  <span className="label me-2 text-fog/60">Explore Trevelin by season</span>
                  {SEASONS.map((season) => {
                    const count = patagonia.filter((i) => i.season === season.key).length;
                    return (
                      <span
                        key={season.key}
                        className={`rounded-full border px-4 py-1.5 text-xs tracking-wide ${
                          count > 0
                            ? "border-ember/40 text-ember"
                            : "border-fog/15 text-fog/40"
                        }`}
                      >
                        {season.label} {count > 0 ? `· ${count}` : ""}
                      </span>
                    );
                  })}
                </div>
              </>
            ) : (
              <EmptyState
                title="No photographs of Trevelin have been added yet"
                body="Only images with a clear licence and a named photographer go on this page, so it stays empty until those exist. Nothing here is stock imagery pretending to be the region."
              />
            )}
          </div>
        </section>

        <section className="mt-24 border-t border-fog/10 pt-20">
          <Reveal>
            <SectionHeading kicker="02 — Project" title="The land, the drawings, the build" />
          </Reveal>
          <div className="mt-10">
            {project.length > 0 ? (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {project.map((image, i) => (
                  <Reveal key={image.id} delay={i * 40}>
                    <ImageCard image={image} />
                  </Reveal>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No project photographs yet"
                body="There is no construction to photograph. Concept drawings and renders will be added here clearly labelled as drawings — never as photographs of something built."
                action={<CtaLink href={path("/join")}>{t("cta.keepPosted")}</CtaLink>}
              />
            )}
          </div>
        </section>
      </div>
    </>
  );
}
