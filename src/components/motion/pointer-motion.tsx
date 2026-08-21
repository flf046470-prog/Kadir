"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * The interactions that answer to the pointer rather than the scroll:
 *
 *  · buttons marked `data-magnetic` lean toward the cursor as it approaches
 *    and spring back when it leaves;
 *  · the hero ridge drifts a few pixels against the pointer, which reads as
 *    the landscape sitting behind the words rather than printed on them.
 *
 * Both are for precise pointers on wide screens only — on a touch screen
 * there is no cursor to answer, and the work would be spent for nothing.
 */
export function PointerMotion() {
  // Rebuilt per route: a new page brings its own buttons and its own hero.
  const pathname = usePathname();

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine) and (min-width: 900px)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches || still.matches) return;

    let cleanup: (() => void) | undefined;
    let cancelled = false;

    const start = async () => {
      const { gsap } = await import("gsap");
      if (cancelled) return;

      const context = gsap.context(() => {
        /* ── magnetic buttons ─────────────────────────────────────────── */
        const magnets = gsap.utils.toArray<HTMLElement>("[data-magnetic]");
        const detach: (() => void)[] = [];

        for (const magnet of magnets) {
          const moveX = gsap.quickTo(magnet, "x", { duration: 0.5, ease: "power3.out" });
          const moveY = gsap.quickTo(magnet, "y", { duration: 0.5, ease: "power3.out" });

          const onMove = (event: PointerEvent) => {
            const box = magnet.getBoundingClientRect();
            // A lean, not a jump: capped so a wide button never slides far
            // enough to leave the cursor outside it.
            const pull = (distance: number) =>
              gsap.utils.clamp(-12, 12, distance * 0.28);
            moveX(pull(event.clientX - (box.left + box.width / 2)));
            moveY(pull(event.clientY - (box.top + box.height / 2)));
          };
          const onLeave = () => {
            moveX(0);
            moveY(0);
          };

          magnet.addEventListener("pointermove", onMove);
          magnet.addEventListener("pointerleave", onLeave);
          magnet.addEventListener("blur", onLeave);
          detach.push(() => {
            magnet.removeEventListener("pointermove", onMove);
            magnet.removeEventListener("pointerleave", onLeave);
            magnet.removeEventListener("blur", onLeave);
          });
        }

        /* ── hero drift ───────────────────────────────────────────────── */
        // The scene inside the backdrop, not the backdrop itself: that one is
        // already owned by the scroll scrub, and two writers on one transform
        // fight each other.
        const ridge = document.querySelector<HTMLElement>(
          '[data-motion="hero-backdrop"] > :first-child',
        );
        if (ridge) {
          // A hair of overscan so the drift never pulls an edge into frame.
          gsap.set(ridge, { scale: 1.04, transformOrigin: "50% 50%" });
          const driftX = gsap.quickTo(ridge, "x", { duration: 1.1, ease: "power2.out" });
          const driftY = gsap.quickTo(ridge, "y", { duration: 1.1, ease: "power2.out" });

          const onMove = (event: PointerEvent) => {
            const x = event.clientX / window.innerWidth - 0.5;
            const y = event.clientY / window.innerHeight - 0.5;
            driftX(-x * 16);
            driftY(-y * 11);
          };
          const onLeave = () => {
            driftX(0);
            driftY(0);
          };

          window.addEventListener("pointermove", onMove, { passive: true });
          document.addEventListener("pointerleave", onLeave);
          detach.push(() => {
            window.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerleave", onLeave);
          });
        }

        return () => {
          for (const off of detach) off();
        };
      });

      cleanup = () => context.revert();
    };

    void start();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [pathname]);

  return null;
}
