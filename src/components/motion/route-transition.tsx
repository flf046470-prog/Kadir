"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Page-to-page transition: the incoming page rises into place instead of
 * appearing. Keyed on the path so React replaces the node — that restarts the
 * CSS animation without any JavaScript running per frame. Disabled by the
 * reduced-motion rule in the stylesheet.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="route-enter">
      {children}
    </div>
  );
}
