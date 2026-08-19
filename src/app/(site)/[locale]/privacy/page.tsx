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
    title: "Privacy",
    description: "What this site collects, why, and how to have it deleted.",
    alternates: { canonical: absoluteUrl(path("/privacy"), settings) },
    robots: { index: true, follow: true },
  };
}

const SECTIONS = [
  {
    title: "What is collected",
    body: [
      "If you join the update list: your first name, email address, the country you typed (optional), the interests you ticked, and the date you signed up.",
      "If you answer the community question: which of the four options you chose, and the country you typed if you gave one. No name and no email.",
      "If you send an idea: the idea itself, plus any name, country or email you chose to add. All three are optional.",
      "Nothing else. There is no analytics script, no advertising pixel, and no third-party tracker on this site.",
    ],
  },
  {
    title: "IP addresses",
    body: [
      "Raw IP addresses are not stored. To stop one person flooding the forms, the address is turned into a one-way hash with a server-side secret and only that hash is kept. It cannot be turned back into an address.",
    ],
  },
  {
    title: "What it is used for",
    body: [
      "Sending project updates you asked for, answering your message, and counting how many people responded. That is the entire list.",
      "Your data is never sold, rented, or shared for anyone else's marketing.",
    ],
  },
  {
    title: "How long it is kept",
    body: [
      "Until you ask for it to be removed, or until the project ends and the list is closed.",
    ],
  },
  {
    title: "Removing your data",
    body: [
      "Every email carries an unsubscribe link. You can also ask for your record to be deleted outright and it will be, along with any idea you sent.",
    ],
  },
  {
    title: "Supporters",
    body: [
      "No payment system is connected to this site, so no payment data exists. If financial support opens later, card details would be handled by the payment provider and never touch this server, and a supporter's name would only ever be published with their explicit permission.",
    ],
  },
];

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { t } = await getPageContext(params);
  return (
    <>
      <PageHeader
        kicker={t("misc.privacy")}
        title="Privacy"
        intro="Short version: an email address, a country, and an answer to one question. Nothing is sold, and nothing is tracked."
      />
      <div className="shell py-20 md:py-28">
        <div className="grid max-w-3xl gap-12">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="font-display text-2xl md:text-3xl">{section.title}</h2>
              <div className="prose-valley mt-4">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
