"use client";

import { useEffect, useState } from "react";

/**
 * The other person's local time, and when you are both awake.
 *
 * The first thirty seconds of a cross-border conversation go on working this
 * out, usually badly, in a language neither person is confident in. It is one
 * line of the header and it removes the exchange entirely.
 *
 * Rendered on the client rather than on the server because a server-rendered
 * clock is wrong from the moment it is sent, and this one is read precisely to
 * decide whether to say something now. The zone comes from the server; the
 * reading of it happens here, and again every half minute.
 *
 * Renders nothing at all when the zone is unknown — which is common, because
 * place ids are free text. A missing line is a feature that quietly does not
 * apply; a wrong one is the app telling someone their match is asleep when
 * they are not.
 */
export function PartnerClock({
  zone,
  locale,
  theirTime,
  bothAwake
}: {
  zone: string | null;
  locale: string;
  /** "Their time" — the label before the clock. */
  theirTime: string;
  /**
   * The shared-window sentence, already built.
   *
   * Formatted on the server rather than assembled here: the message carries
   * ICU placeholders, and next-intl resolves those at `t()` time. Handing this
   * component the template and doing the substitution by hand is what printed
   * a literal `app.bothAwake` into the header — `t()` with no values for a
   * message that has them returns the key.
   */
  bothAwake: string | null;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    if (!zone) return;

    // Set inside the effect rather than as initial state: rendering a time on
    // the server and a different one on the client is a hydration mismatch,
    // and the server's would be stale anyway.
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [zone]);

  if (!zone || !now) return null;

  let time: string;
  try {
    time = new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit"
    }).format(now);
  } catch {
    return null;
  }

  return (
    <p className="mt-1 text-sm text-ink/50">
      <span>
        {theirTime} {time}
      </span>
      {bothAwake && (
        <>
          <span aria-hidden="true"> · </span>
          <span>{bothAwake}</span>
        </>
      )}
    </p>
  );
}
