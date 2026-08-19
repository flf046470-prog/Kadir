import type { MessageKey } from "./i18n";

/** Shared by the server layout and the client mobile menu, so it lives outside server-only code. */
export const NAV_LINKS: { href: string; key: MessageKey }[] = [
  { href: "/project", key: "nav.project" },
  { href: "/story", key: "nav.story" },
  { href: "/progress", key: "nav.progress" },
  { href: "/transparency", key: "nav.transparency" },
  { href: "/journal", key: "nav.journal" },
  { href: "/updates", key: "nav.updates" },
  { href: "/gallery", key: "nav.gallery" },
  { href: "/location", key: "nav.location" },
  { href: "/support", key: "nav.support" },
];
