"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isNative, nativePlatform, routeForDeepLink } from "@/lib/native/bridge";

/**
 * Everything the app does *because* it is running inside the native shell.
 *
 * Renders nothing. In a browser every effect returns immediately, and the
 * Capacitor plugins are behind dynamic imports inside the native branch — so a
 * web visitor never downloads a byte of them.
 *
 * Each plugin import is guarded on its own rather than gathered into one
 * `Promise.all`. A shell built without one of them (an older install, a plugin
 * removed from a platform) should lose that single behaviour, not all of them.
 */
export function NativeShell({ allowedHosts }: { allowedHosts: string[] }) {
  const router = useRouter();

  useEffect(() => {
    if (!isNative()) return;

    const cleanups: Array<() => void> = [];
    let cancelled = false;

    /** Runs `work`, and ignores a plugin that is simply not in this build. */
    async function withPlugin(load: () => Promise<void>, name: string) {
      try {
        await load();
      } catch (error) {
        console.error(`Native plugin unavailable: ${name}`, error);
      }
    }

    void (async () => {
      // The splash is held until here rather than dismissed on a timer: this
      // runs once React has actually mounted, so there is no white gap between
      // the splash going and the app appearing.
      await withPlugin(async () => {
        const { SplashScreen } = await import("@capacitor/splash-screen");
        await SplashScreen.hide();
      }, "splash-screen");

      await withPlugin(async () => {
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        // `Style.Light` is the plugin's name for *dark glyphs on a light bar*,
        // which is what the app needs: `body` is white and so is the header
        // above it, and light glyphs on that are invisible.
        await StatusBar.setStyle({ style: Style.Light });
        if (nativePlatform() === "android") {
          // White, to match the header the bar sits directly above — the pale
          // pink belongs to the launch frame, not to the running app. Ignored
          // from Android 15, which forces a transparent bar over the page; the
          // page under it is white, so the result is the same either way.
          await StatusBar.setBackgroundColor({ color: "#ffffff" });
        }
      }, "status-bar");

      await withPlugin(async () => {
        const { App } = await import("@capacitor/app");

        /**
         * Android's hardware back button.
         *
         * Without this it closes the app from anywhere — including mid
         * conversation — because the webview's own history means nothing to
         * the system. `canGoBack` is what distinguishes "go back a screen"
         * from "there is nowhere back to go, so leaving is what was meant".
         */
        const back = await App.addListener("backButton", ({ canGoBack }) => {
          if (canGoBack) window.history.back();
          else void App.exitApp();
        });

        /**
         * Deep links. The referral link is the case that matters: a tap on
         * fiorematch.com/tr/register?ref=… should land in the app with the code
         * already there.
         *
         * `routeForDeepLink` refuses anything that is not ours, and this
         * navigates rather than assigning `location` so the app does a client
         * transition instead of a full reload that would show the splash again.
         */
        const open = await App.addListener("appUrlOpen", ({ url }) => {
          const path = routeForDeepLink(url, allowedHosts);
          if (path) router.push(path);
        });

        if (cancelled) {
          void back.remove();
          void open.remove();
          return;
        }
        cleanups.push(() => void back.remove(), () => void open.remove());
      }, "app");

      await withPlugin(async () => {
        const { Keyboard } = await import("@capacitor/keyboard");
        // Scroll the focused field into view instead of letting the keyboard
        // cover the composer.
        await Keyboard.setScroll({ isDisabled: false });
      }, "keyboard");
    })();

    return () => {
      cancelled = true;
      for (const cleanup of cleanups) cleanup();
    };
  }, [router, allowedHosts]);

  return null;
}
