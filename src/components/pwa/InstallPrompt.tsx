"use client";

import { useEffect, useState } from "react";
import { isNative } from "@/lib/native/bridge";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "fm.install.dismissed";

/**
 * The "add to home screen" banner.
 *
 * Only rendered once the browser has said the app is actually installable —
 * `beforeinstallprompt` fires when the manifest, the service worker and the
 * engagement heuristics all agree. Drawing a button before that produces one
 * that either does nothing or lies about what tapping it will do.
 *
 * A dismissal is remembered, because a banner that reappears on every page is
 * an advert. It is remembered in `localStorage` rather than server-side
 * deliberately: this is a property of the *device*, not the member — the same
 * person on their laptop has not installed anything.
 *
 * iOS has no `beforeinstallprompt` at all; Safari installs from the share
 * sheet and gives a page no way to trigger or detect it. Rather than show
 * iPhone users a button that cannot work, this renders nothing there, which is
 * why the check is for the event and not for the platform.
 */
export function InstallPrompt({
  labels
}: {
  labels: { pitch: string; install: string; dismiss: string };
}) {
  const [event, setEvent] = useState<InstallEvent | null>(null);

  useEffect(() => {
    // Already inside the installed app: there is nothing to add to a home
    // screen, and `beforeinstallprompt` never fires here anyway.
    if (isNative()) return;

    try {
      if (localStorage.getItem(DISMISSED_KEY)) return;
    } catch {
      // Private mode, or storage blocked. Showing the banner is the safe
      // fallback: the worst case is that it reappears.
    }

    function onPrompt(nativeEvent: Event) {
      // Suppressing the browser's own mini-infobar so it does not stack with
      // this one. Keeping the event is what lets the button work later.
      nativeEvent.preventDefault();
      setEvent(nativeEvent as InstallEvent);
    }

    window.addEventListener("beforeinstallprompt", onPrompt);
    // Fired when installation completes by any route, including Safari's share
    // sheet — at which point the banner is stale and should go.
    window.addEventListener("appinstalled", () => setEvent(null));

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!event) return null;

  function remember() {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Nothing to do — the banner simply comes back next time.
    }
    setEvent(null);
  }

  async function install() {
    const pending = event;
    if (!pending) return;
    // The event is single-use; clearing it first stops a double tap throwing.
    setEvent(null);
    await pending.prompt();
    const choice = await pending.userChoice;
    if (choice.outcome === "dismissed") remember();
  }

  return (
    <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)+4.75rem)] z-40 flex items-center gap-3 rounded-2xl border border-black/5 bg-white/95 p-3 shadow-lg backdrop-blur sm:bottom-4 sm:left-auto sm:right-4 sm:w-80">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" width={36} height={36} className="rounded-lg" />
      <p className="flex-1 text-sm text-ink/80">{labels.pitch}</p>
      <button type="button" onClick={install} className="btn-primary shrink-0 px-4 py-1.5 text-sm">
        {labels.install}
      </button>
      <button
        type="button"
        onClick={remember}
        aria-label={labels.dismiss}
        className="shrink-0 px-1 text-lg leading-none text-ink/40 hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}
