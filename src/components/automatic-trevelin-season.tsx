"use client";
import { useEffect } from "react";

/** Keeps the visible homepage season aligned to Trevelin, Argentina. */
export function AutomaticTrevelinSeason() {
  useEffect(() => {
    const names = ["spring", "summer", "autumn", "winter"] as const;
    const resolveIndex = () => {
      const month = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Buenos_Aires", month: "numeric" }).format(new Date()));
      return month >= 9 && month <= 11 ? 0 : month === 12 || month <= 2 ? 1 : month <= 5 ? 2 : 3;
    };
    const update = () => {
      const index = resolveIndex();
      const choices = document.querySelectorAll<HTMLButtonElement>(".ss-choice");
      if (choices.length !== 4) return;
      const chosen = choices[index];
      if (chosen?.getAttribute("aria-pressed") !== "true") chosen?.click();
      try { window.localStorage.setItem("skysphere-season", names[index]); } catch { /* storage optional */ }
    };
    // React mounts the selector asynchronously; retry briefly, then hourly.
    update();
    let retries = 0;
    const start = window.setInterval(() => {
      update();
      retries += 1;
      if (retries >= 15) window.clearInterval(start);
    }, 1000);
    const interval = window.setInterval(update, 60 * 60 * 1000);
    return () => { window.clearInterval(start); window.clearInterval(interval); };
  }, []);
  return <><style>{".ss-switcher{display:none!important}"}</style><span hidden data-automatic-trevelin-season="enabled" /></>;
}
