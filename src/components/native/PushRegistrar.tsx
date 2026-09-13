"use client";

import { useEffect } from "react";
import { isNative, nativePlatform } from "@/lib/native/bridge";

const ASKED_KEY = "fm.push.asked";

/**
 * Asks for notification permission, then registers the device.
 *
 * **When** it asks is the whole design. The permission dialog can be shown
 * once per install — a "no" is close to permanent — so asking on first launch,
 * before the member has any reason to want notifications, spends the single
 * chance at the worst possible moment.
 *
 * So this only mounts where `enabled` is true, which the caller sets once the
 * member has something to be notified *about*: a match. At that point the ask
 * is legible, and the answer is informed.
 *
 * Sending is not built. That needs Firebase Cloud Messaging and Apple Push
 * Notification credentials, which belong to the publishing account. What works
 * today is the device ending up in `push_tokens` against the right member.
 */
export function PushRegistrar({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled || !isNative()) return;

    let cancelled = false;

    void (async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");

        const current = await PushNotifications.checkPermissions();

        // "denied" is respected and never re-asked: the OS would not show the
        // dialog again anyway, and pestering someone who said no is how an app
        // gets deleted.
        if (current.receive === "denied") return;

        if (current.receive === "prompt" || current.receive === "prompt-with-rationale") {
          if (localStorage.getItem(ASKED_KEY)) return;
          localStorage.setItem(ASKED_KEY, "1");

          const asked = await PushNotifications.requestPermissions();
          if (asked.receive !== "granted") return;
        }

        if (cancelled) return;

        // The token does not arrive from `register()` — it comes back on this
        // listener, which must therefore be attached first.
        await PushNotifications.addListener("registration", (token) => {
          const platform = nativePlatform();
          if (platform === "web") return;

          void fetch("/api/push/tokens", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: token.value, platform })
          }).catch(() => {
            // The device simply stays unregistered until the next launch.
            // Nothing to show the member: they did not ask for this to happen
            // now, and it will retry on its own.
          });
        });

        await PushNotifications.addListener("registrationError", (error) => {
          console.error("Push registration failed", error);
        });

        await PushNotifications.register();
      } catch (error) {
        console.error("Push notifications unavailable", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return null;
}
