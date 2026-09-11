"use client";

import { useEffect } from "react";

/**
 * Registers the service worker, once, after the page has settled.
 *
 * Deferred to the `load` event rather than fired on mount: registration and
 * precaching compete with the requests that actually put content on screen,
 * and on a slow connection winning that race by a second is worth more than
 * being installable a second earlier.
 *
 * Development is excluded. A stale worker serving a cached build while you are
 * editing is a confusing hour, and the offline behaviour is worth testing
 * against a production build anyway.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    function register() {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        // Not fatal: without a worker the app is an ordinary website, which is
        // the same thing every first-time visitor gets.
        console.error("Service worker registration failed", error);
      });
    }

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
