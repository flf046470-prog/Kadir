import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { getPageContext } from "@/lib/page";
import { absoluteUrl } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { settings, path } = await getPageContext(params);
  return {
    title: "Terms",
    description: "The terms this site is published under while the project is in planning.",
    alternates: { canonical: absoluteUrl(path("/terms"), settings) },
  };
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { t } = await getPageContext(params);
  return (
    <>
      <PageHeader
        kicker={t("misc.terms")}
        title="Terms"
        intro="This site describes a project that has not been built. Please read it as a record of intent, not as an offer."
      />
      <div className="shell py-20 md:py-28">
        <div className="grid max-w-3xl gap-12">
          <section>
            <h2 className="font-display text-2xl md:text-3xl">What this site is</h2>
            <div className="prose-valley mt-4">
              <p>
                Patagonia Underground is a project in planning. Everything published here — the
                concept, the drawings, the phases and the intentions — describes what is planned,
                not what exists.
              </p>
              <p>
                No accommodation is available. There is nothing to book, no dates, no prices, and no
                reservation system.
              </p>
            </div>
          </section>

          <section>
            <h2 className="font-display text-2xl md:text-3xl">No offer, no return</h2>
            <div className="prose-valley mt-4">
              <p>
                Nothing on this site is an offer of investment, ownership, shares, or any financial
                product. Joining the update list gives you updates and nothing else.
              </p>
              <p>
                Should financial support open in the future, supporting the project would not
                guarantee a reservation, ownership, profit, or any other financial return.
              </p>
            </div>
          </section>

          <section>
            <h2 className="font-display text-2xl md:text-3xl">Ideas you send</h2>
            <div className="prose-valley mt-4">
              <p>
                If you send an idea, it may be read, discussed, and used in the project. It is only
                published on this site — with the name you gave — if you provided a name and the
                project owner chose to publish it. Your email is never published.
              </p>
            </div>
          </section>

          <section>
            <h2 className="font-display text-2xl md:text-3xl">Accuracy</h2>
            <div className="prose-valley mt-4">
              <p>
                Plans change, and this site changes with them. Dates, phases and descriptions are
                accurate at the time of writing and will be corrected in public when they stop being
                accurate.
              </p>
              <p>
                Regional information — distances, opening hours, seasons, border crossings — is
                given as orientation only. Check it at the time of travel.
              </p>
            </div>
          </section>

          <section>
            <h2 className="font-display text-2xl md:text-3xl">Images</h2>
            <div className="prose-valley mt-4">
              <p>
                Illustrations and diagrams on this site are original artwork made for it. Any
                photograph carries its photographer and licence in the gallery. No image is
                presented as a photograph of something that has not been built.
              </p>
            </div>
          </section>

          <section>
            <h2 className="font-display text-2xl md:text-3xl">Contact</h2>
            <div className="prose-valley mt-4">
              <p>
                Questions, corrections, or a request to delete your data: send them through the idea
                form, or reply to any update email once you are on the list.
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
