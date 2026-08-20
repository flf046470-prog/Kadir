import type { Translator } from "@/lib/i18n";
import type { JoinFormLabels } from "@/components/community-form";
import type { Landmark } from "@/components/explore/terrain-scene";

/** One definition of the sign-up form's copy, reused by every form on the site. */
export function joinFormLabels(t: Translator, settings: Record<string, string>): JoinFormLabels {
  return {
    firstName: t("form.firstName"),
    email: t("form.email"),
    country: t("form.country"),
    optional: t("form.optional"),
    consent: t("form.consent"),
    privacy: settings["community.privacyNote"] ?? t("form.privacy"),
    submit: t("cta.followJourney"),
    sending: t("form.sending"),
    success: settings["community.successMessage"] ?? t("notify.success"),
    successNote:
      "Nothing else is needed from you. Updates arrive when something real happens — not on a schedule.",
    interestsTitle: t("notify.title"),
    interests: [
      { value: "updates", label: t("notify.updates") },
      { value: "opening", label: t("notify.opening") },
      { value: "reservations", label: t("notify.reservations") },
      { value: "early_guest", label: t("notify.earlyGuest") },
    ],
  };
}

/**
 * Landmarks in the conceptual 3D valley. Their copy describes the region in
 * general terms — none of them claims to mark a surveyed position.
 */
export function landmarksFor(t: Translator): Landmark[] {
  return [
    {
      id: "mountains",
      title: t("explore.mountains"),
      body: "The cordillera along the western edge of the department, rising toward the Chilean border.",
      x: -54,
      z: -18,
      color: 0x9fc0cd,
    },
    {
      id: "forest",
      title: t("explore.forest"),
      body: "Andean-Patagonian forest on the western slopes — the same forest type protected in Los Alerces National Park to the north-west.",
      x: -22,
      z: 26,
      color: 0x6d8060,
    },
    {
      id: "water",
      title: t("explore.water"),
      body: "The valley's rivers and lakes. In the real landscape, the Futaleufú system runs west toward the border crossing.",
      x: 34,
      z: 30,
      color: 0x7fa3b5,
    },
    {
      id: "town",
      title: t("explore.town"),
      body: "A small town founded by Welsh settlers, whose name means 'town of the mill'.",
      x: 26,
      z: -30,
      color: 0xd98b52,
    },
    {
      id: "home",
      title: t("explore.home"),
      body: "The design concept, drawn in three dimensions: a circular plan cut into the shelf, the meadow returned over its roof, a glazed dome over the courtyard and one open face to the valley. Nothing is built — this is the concept, not a survey and not a finished design. The real plot location is not published yet.",
      x: 2,
      z: -4,
      color: 0xc0603a,
    },
  ];
}
