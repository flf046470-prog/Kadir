"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Wraps each word of a heading in a clipping mask so it can rise into view.
 *
 * Returns the function that puts the original markup back, or null when the
 * heading is left alone — headings that already contain elements, very long
 * ones, and right-to-left text, where inline-block words would break the bidi
 * ordering of the line.
 */
function splitIntoWords(el: HTMLElement): (() => void) | null {
  if (el.dataset.split === "true" || el.children.length > 0) return null;
  if (getComputedStyle(el).direction === "rtl") return null;

  const text = el.textContent ?? "";
  if (!text.trim() || text.length > 160) return null;

  const original = el.innerHTML;
  const words = text.trim().split(/\s+/);
  const fragment = document.createDocumentFragment();

  words.forEach((word, i) => {
    const mask = document.createElement("span");
    mask.className = "sm-mask";
    const inner = document.createElement("span");
    inner.className = "sm-word";
    inner.textContent = word;
    mask.appendChild(inner);
    fragment.appendChild(mask);
    if (i < words.length - 1) fragment.appendChild(document.createTextNode(" "));
  });

  el.textContent = "";
  el.appendChild(fragment);
  el.dataset.split = "true";

  return () => {
    el.innerHTML = original;
    delete el.dataset.split;
  };
}

/**
 * Outline length of an SVG shape, or 0 when it cannot be measured — a shape
 * inside a hidden branch of the layout throws instead of answering.
 */
function pathLength(node: SVGGeometryElement): number {
  try {
    return node.getTotalLength();
  } catch {
    return 0;
  }
}

/**
 * Every scroll-driven animation on the site, in one place.
 *
 * The markup and the design are untouched: this reads elements that are already
 * on the page (`.reveal`, and a handful of `data-motion` hooks) and animates
 * them. GSAP is imported at runtime so it stays out of the first payload, and
 * the whole set is built inside a `gsap.context()` so unmounting reverts every
 * tween and kills every ScrollTrigger.
 *
 * Nothing here is required for the page to be readable: `.reveal` elements are
 * shown by CSS when motion is reduced, and by the <noscript> rule when scripts
 * never run.
 */
export function ScrollMotion() {
  // The layout survives client-side navigation, so the whole set is rebuilt for
  // each route: the previous page's triggers are reverted and the new page's
  // elements get their own.
  const pathname = usePathname();

  useEffect(() => {
    let context: { revert: () => void } | undefined;
    let matchMediaInstance: { revert: () => void } | undefined;
    let disconnect: (() => void) | undefined;
    let cancelled = false;

    const start = async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (cancelled) return;

      gsap.registerPlugin(ScrollTrigger);
      // Mobile browsers fire resize when the URL bar hides; ignoring it keeps
      // pinned and scrubbed values from jumping mid-scroll.
      ScrollTrigger.config({ ignoreMobileResize: true });

      const buildAll = () => {
      context = gsap.context(() => {
        const media = gsap.matchMedia();
        matchMediaInstance = media;

        /* ── reduced motion: no movement, everything simply present ────── */
        media.add("(prefers-reduced-motion: reduce)", () => {
          gsap.set(".reveal", { clearProps: "all", opacity: 1, y: 0 });
          document
            .querySelectorAll<HTMLElement>(".reveal")
            .forEach((el) => (el.dataset.visible = "true"));
        });

        media.add("(prefers-reduced-motion: no-preference)", () => {
          const ease = "power2.out";
          /** Undo for anything that touches the DOM rather than just tweening. */
          const restores: (() => void)[] = [];

          /**
           * Plays something the first time its trigger is reached.
           *
           * `once: true` would be the obvious way to write this, but GSAP
           * implements it by killing the trigger from inside the callback —
           * and that callback can fire while GSAP is walking its own list of
           * triggers during a refresh, which makes it read past the end of
           * that list. A latch does the same job and never mutates the list.
           */
          const playOnce = (
            trigger: Element,
            start: string,
            play: () => void,
          ) => {
            let played = false;
            ScrollTrigger.create({
              trigger,
              start,
              onEnter: () => {
                if (played) return;
                played = true;
                play();
              },
            });
          };

          /* ── 1 · hero ─────────────────────────────────────────────────
             The ridge settles back as the page moves, the words lift away
             a little faster. Both are scrubbed, so they follow the finger
             on a phone rather than playing on their own.                  */
          const hero = document.querySelector<HTMLElement>('[data-motion="hero"]');
          if (hero) {
            const backdrop = hero.querySelector('[data-motion="hero-backdrop"]');
            const content = hero.querySelector<HTMLElement>('[data-motion="hero-content"]');

            /* The opening. Held back by the inline script in <head> until we
               get here — and released by that script's own timer if this code
               never arrives, so the hero is never left invisible. */
            if (content && document.documentElement.dataset.intro === "pending") {
              document.documentElement.dataset.intro = "playing";
              const title = content.querySelector<HTMLElement>("h1");
              const restore = title ? splitIntoWords(title) : null;
              if (restore) restores.push(restore);

              const intro = gsap.timeline({
                defaults: { ease: "power3.out" },
                onComplete: () => delete document.documentElement.dataset.intro,
              });
              intro
                .from(content.children, {
                  y: 26,
                  opacity: 0,
                  duration: 1,
                  stagger: 0.09,
                })
                .from(
                  content.querySelectorAll(".sm-word"),
                  { yPercent: 118, duration: 1.15, ease: "expo.out", stagger: 0.06 },
                  0.12,
                )
                .from(
                  backdrop,
                  { opacity: 0, duration: 1.6, ease: "power2.inOut" },
                  0,
                );
            }

            if (backdrop) {
              // Starts at exactly the framing the page ships with, so the
              // hero at rest is the design untouched, and only opens up as
              // the page moves.
              gsap.fromTo(
                backdrop,
                { scale: 1, yPercent: 0 },
                {
                  scale: 1.1,
                  yPercent: 7,
                  ease: "none",
                  scrollTrigger: {
                    trigger: hero,
                    start: "top top",
                    end: "bottom top",
                    scrub: 0.6,
                  },
                },
              );
            }

            /* The landscape dissolves into the drawing of the house — slowly,
               across the whole hero, so it reads as one continuous shot. */
            const concept = hero.querySelector('[data-motion="hero-concept"]');
            if (concept) {
              gsap.fromTo(
                concept,
                { opacity: 0 },
                {
                  opacity: 1,
                  ease: "none",
                  scrollTrigger: {
                    trigger: hero,
                    start: "22% top",
                    end: "bottom top",
                    scrub: 0.8,
                  },
                },
              );
            }

            if (content) {
              gsap.to(content, {
                yPercent: -14,
                opacity: 0,
                ease: "none",
                scrollTrigger: {
                  trigger: hero,
                  start: "top top",
                  end: "70% top",
                  scrub: 0.4,
                },
              });
            }
          }

          /* ── 2 · depth ────────────────────────────────────────────────
             Contour washes and map layers drift at their own rate, so the
             land reads as layers rather than one flat drawing.            */
          gsap.utils.toArray<HTMLElement>("[data-parallax]").forEach((layer) => {
            const depth = Number(layer.dataset.parallax) || 0.1;
            gsap.fromTo(
              layer,
              { yPercent: -depth * 50 },
              {
                yPercent: depth * 50,
                ease: "none",
                scrollTrigger: {
                  trigger: layer.closest("section") ?? layer,
                  start: "top bottom",
                  end: "bottom top",
                  scrub: 0.8,
                },
              },
            );
          });

          gsap.utils.toArray<SVGElement>("[data-depth]").forEach((layer) => {
            const depth = Number(layer.dataset.depth) || 1;
            gsap.fromTo(
              layer,
              { yPercent: -1.5 * depth, xPercent: -0.8 * depth },
              {
                yPercent: 1.5 * depth,
                xPercent: 0.8 * depth,
                ease: "none",
                scrollTrigger: {
                  trigger: layer.closest("section") ?? layer,
                  start: "top bottom",
                  end: "bottom top",
                  scrub: 1,
                },
              },
            );
          });

          /* ── 3 · sections ─────────────────────────────────────────────
             One batched trigger for every .reveal on the page instead of
             one per element — the same fade-up the site already had, just
             smoother and cheaper.                                          */
          ScrollTrigger.batch(".reveal", {
            start: "top 88%",
            onEnter: (batch) =>
              gsap.to(
                batch.filter((el) => (el as HTMLElement).dataset.visible !== "true"),
                {
                  opacity: 1,
                  y: 0,
                  duration: 0.9,
                  ease,
                  stagger: 0.08,
                  overwrite: true,
                  onStart: () => {
                    for (const el of batch) (el as HTMLElement).dataset.visible = "true";
                  },
                },
              ),
          });

          /* ── 3b · headlines ───────────────────────────────────────────
             Section titles rise out of a mask, a word at a time, with the
             numbered kicker arriving just ahead of them. Only headings
             inside an already-hidden .reveal are split, so the swap to
             masked words is never visible.                                */
          gsap.utils
            .toArray<HTMLElement>(".reveal :is(h1, h2).font-display")
            .forEach((heading) => {
              const restore = splitIntoWords(heading);
              if (!restore) return;
              restores.push(restore);

              const block = heading.closest(".reveal") ?? heading;
              const kicker = heading.previousElementSibling;
              const labelled = kicker?.classList.contains("label") ?? false;

              playOnce(block, "top 86%", () => {
                const timeline = gsap.timeline();
                if (labelled && kicker) {
                  timeline.from(kicker, { y: 12, opacity: 0, duration: 0.5, ease });
                }
                timeline.from(
                  heading.querySelectorAll(".sm-word"),
                  { yPercent: 115, duration: 1, ease: "expo.out", stagger: 0.055 },
                  labelled ? "-=0.3" : 0,
                );
              });
            });

          /* ── 3c · the narrative stage ─────────────────────────────────
             One drawing is held while the text walks past; each step hands
             over to the next as it reaches the middle of the screen.      */
          const story = document.querySelector<HTMLElement>('[data-motion="story"]');
          if (story) {
            const visuals = gsap.utils.toArray<HTMLElement>("[data-story-visual]", story);
            const stepEls = gsap.utils.toArray<HTMLElement>("[data-story-step]", story);

            const show = (index: number) => {
              visuals.forEach((visual, i) => {
                gsap.to(visual, {
                  opacity: i === index ? 1 : 0,
                  duration: 0.7,
                  ease: "power2.inOut",
                  overwrite: "auto",
                });
              });
            };

            stepEls.forEach((step, i) => {
              ScrollTrigger.create({
                trigger: step,
                start: "top 60%",
                end: "bottom 40%",
                onEnter: () => show(i),
                onEnterBack: () => show(i),
              });
            });

            // Each step's words rise as it takes the stage.
            for (const step of stepEls) {
              playOnce(step, "top 78%", () =>
                gsap.from(step.children, {
                  y: 20,
                  opacity: 0,
                  duration: 0.8,
                  ease,
                  stagger: 0.07,
                }),
              );
            }
          }

          /* ── 4 · the house, drawn ─────────────────────────────────────
             The cross-section builds in the order it would be built: raft
             and drainage, retaining walls, the soil cover, then the dome.  */
          const diagram = document.querySelector<SVGSVGElement>('[data-motion="section-diagram"]');
          // Narrow layouts hide the diagram; path lengths cannot be measured on
          // a display:none element, so there is nothing to draw there.
          if (diagram && diagram.getBoundingClientRect().width > 0) {
            const order = ["foundation", "walls", "roof", "glass"];
            const timeline = gsap.timeline({
              scrollTrigger: {
                trigger: diagram,
                start: "top 78%",
                end: "bottom 60%",
                scrub: 0.8,
              },
            });

            for (const part of order) {
              const nodes = gsap.utils.toArray<SVGGeometryElement>(
                `[data-motion="section-diagram"] [data-part="${part}"]`,
              );
              if (nodes.length === 0) continue;

              // Stroked outlines draw themselves; filled shapes fade up.
              const strokes = nodes.filter(
                (node) => pathLength(node) > 0 && getComputedStyle(node).stroke !== "none",
              );
              const fills = nodes.filter((node) => !strokes.includes(node));

              if (strokes.length) {
                timeline.from(
                  strokes,
                  {
                    strokeDasharray: (i, target: SVGGeometryElement) => {
                      const length = pathLength(target);
                      return `${length} ${length}`;
                    },
                    strokeDashoffset: (i, target: SVGGeometryElement) => pathLength(target),
                    duration: 1,
                    ease: "none",
                    stagger: 0.15,
                  },
                  ">-0.4",
                );
              }
              if (fills.length) {
                timeline.from(
                  fills,
                  { opacity: 0, duration: 0.8, ease, stagger: 0.12 },
                  strokes.length ? "<0.2" : ">-0.4",
                );
              }
            }
          }

          /* ── 5 · community ────────────────────────────────────────────
             The question settles in, then the four answers arrive in turn. */
          const community = document.querySelector<HTMLElement>('[data-motion="community"]');
          if (community) {
            const question = community.querySelector('[data-motion="community-question"]');
            const cards = community.querySelectorAll('[data-motion="vote-cards"] > *');

            playOnce(community, "top 72%", () => {
              const timeline = gsap.timeline();
              if (question) {
                timeline.fromTo(
                  question,
                  { scale: 0.97, opacity: 0, y: 16 },
                  { scale: 1, opacity: 1, y: 0, duration: 0.85, ease },
                );
              }
              if (cards.length) {
                timeline.fromTo(
                  cards,
                  { opacity: 0, y: 22 },
                  { opacity: 1, y: 0, duration: 0.7, ease, stagger: 0.09 },
                  "-=0.45",
                );
              }
            });
          }

          /* ── 6 · support ──────────────────────────────────────────────
             Cards and figures arrive in sequence. No bounce — the page is
             quiet everywhere else and should stay quiet here.              */
          gsap.utils
            .toArray<HTMLElement>('[data-motion="stagger"]')
            .forEach((group) => {
              const children = group.children;
              if (children.length === 0) return;
              playOnce(group, "top 82%", () =>
                gsap.fromTo(
                  children,
                  { opacity: 0, y: 24 },
                  { opacity: 1, y: 0, duration: 0.75, ease, stagger: 0.08 },
                ),
              );
            });

          /* ── 6b · the journey line ────────────────────────────────────
             The rail behind the phase list draws downward as you read it,
             so the timeline is travelled rather than just displayed.      */
          gsap.utils
            .toArray<HTMLElement>('[data-motion="timeline-line"]')
            .forEach((line) => {
              const list = line.parentElement ?? line;
              gsap.fromTo(
                line,
                { scaleY: 0 },
                {
                  scaleY: 1,
                  ease: "none",
                  transformOrigin: "top center",
                  scrollTrigger: {
                    trigger: list,
                    start: "top 75%",
                    end: "bottom 80%",
                    scrub: 0.5,
                  },
                },
              );
            });

          /* ── 7 · footer ───────────────────────────────────────────────
             A slower, longer fade so the page comes to rest rather than
             stopping.                                                      */
          const footer = document.querySelector<HTMLElement>('[data-motion="footer"]');
          if (footer) {
            playOnce(footer, "top 95%", () =>
              gsap.fromTo(
                footer,
                { opacity: 0.25, y: 28 },
                { opacity: 1, y: 0, duration: 1.4, ease: "power1.out" },
              ),
            );
          }

          // Runs when the query stops matching or the context is reverted:
          // tweens are undone by GSAP, the word masks by us.
          return () => {
            for (const restore of restores) restore();
          };
        });

        /* ── 8 · atmosphere ──────────────────────────────────────────────
           Wider screens get the cinematic layer on top: light that answers
           to movement, and content that recedes into depth as it leaves.
           All of it is scrubbed from a resting state identical to the page
           as designed, so standing still shows the site untouched.        */
        media.add(
          "(min-width: 900px) and (prefers-reduced-motion: no-preference)",
          () => {
            const ease = "power2.out";

            /* Light. A warm wash from below and a cold one from the upper
               valley, both invisible until the page is actually moving —
               the faster you travel, the more the air catches the light. */
            const air = document.createElement("div");
            air.className = "sm-atmosphere";
            air.setAttribute("aria-hidden", "true");
            document.body.appendChild(air);

            const glow = gsap.quickTo(air, "opacity", { duration: 0.5, ease });
            const settle = () => glow(0);
            const tracker = ScrollTrigger.create({
              onUpdate: (self) => {
                const speed = Math.min(Math.abs(self.getVelocity()) / 2600, 1);
                glow(0.18 + speed * 0.82);
              },
            });
            ScrollTrigger.addEventListener("scrollEnd", settle);

            /* Depth. A section's words drift back and dim as they leave the
               frame while its ground stays put, so the page reads as planes
               at different distances rather than one sheet of paper.      */
            gsap.utils
              .toArray<HTMLElement>("main section > .shell")
              .forEach((content) => {
                if (content.dataset.motion === "hero-content") return;
                gsap.to(content, {
                  opacity: 0.35,
                  scale: 0.975,
                  ease: "none",
                  scrollTrigger: {
                    // Only once the block is genuinely on its way out: text
                    // still being read must never lose contrast.
                    trigger: content,
                    start: "bottom 32%",
                    end: "bottom -5%",
                    scrub: 0.7,
                  },
                });
              });

            /* Focus. Titles arrive out of the haze as they settle. */
            gsap.utils
              .toArray<HTMLElement>(".reveal :is(h1, h2).font-display")
              .forEach((heading) => {
                let pulled = false;
                ScrollTrigger.create({
                  trigger: heading.closest(".reveal") ?? heading,
                  start: "top 86%",
                  onEnter: () => {
                    if (pulled) return;
                    pulled = true;
                    gsap.fromTo(
                      heading,
                      { filter: "blur(10px)" },
                      { filter: "blur(0px)", duration: 1.2, ease },
                    );
                  },
                });
              });

            return () => {
              ScrollTrigger.removeEventListener("scrollEnd", settle);
              tracker.kill();
              air.remove();
            };
          },
        );
      });

      };

      /* The router reports a new path before the new page has streamed into
         <main>, and a page can grow again as suspended parts arrive. Rather
         than guessing that moment, watch the document and rebuild whenever the
         set of animatable blocks actually changes. Comparing the blocks — not
         raw mutations — is what keeps this from reacting to its own work:
         splitting a heading into words rewrites the DOM but changes no block. */
      const main = document.getElementById("main");
      let lastCount = -1;
      let lastRoot: Element | null = null;

      const changed = () => {
        const count = document.querySelectorAll(".reveal, [data-motion]").length;
        const root = main?.firstElementChild ?? null;
        const moved = count !== lastCount || root !== lastRoot;
        lastCount = count;
        lastRoot = root;
        return moved;
      };

      /* A trigger whose element has left the document cannot be measured.
         Dropping one is only safe outside a refresh, though: GSAP walks its
         own trigger list while refreshing, and removing an entry mid-walk is
         what makes it read past the end of that list. So this is called from
         one place only — inside the guarded rebuild below. */
      const killDetached = () => {
        for (const trigger of ScrollTrigger.getAll()) {
          const el = trigger.trigger as Element | undefined;
          if (el && !el.isConnected) trigger.kill();
        }
      };

      // Measuring is safe at any time; it never mutates the trigger list.
      const safeRefresh = () => {
        if (!cancelled) ScrollTrigger.refresh();
      };

      const rebuild = () => {
        if (cancelled) return;
        // Never tear triggers down while ScrollTrigger is measuring: it is
        // walking the very list this would empty. Wait for it to finish.
        if ((ScrollTrigger as { isRefreshing?: boolean }).isRefreshing) {
          window.clearTimeout(idle);
          idle = window.setTimeout(rebuild, 200);
          return;
        }
        try {
          killDetached();
          matchMediaInstance?.revert();
          context?.revert();
          buildAll();
          changed();
        } catch {
          // A rebuild that collides with GSAP's own measuring pass can throw
          // from inside it. The page is unharmed — the set is simply half
          // built — so try again on a later tick rather than surfacing it.
          window.clearTimeout(idle);
          idle = window.setTimeout(rebuild, 300);
          return;
        }
        // Measure from a fresh task, never from inside an animation frame:
        // refreshing while the ticker is running is what provokes the above.
        window.setTimeout(safeRefresh, 0);
      };

      let idle: number | undefined;
      const observer = main
        ? new MutationObserver(() => {
            window.clearTimeout(idle);
            idle = window.setTimeout(() => {
              if (changed()) rebuild();
            }, 140);
          })
        : undefined;

      observer?.observe(main!, { childList: true, subtree: true });

      buildAll();
      changed();
      // Late-loading fonts and images change element heights; measure again
      // once they land, dropping anything detached in the meantime.
      window.setTimeout(safeRefresh, 0);
      document.fonts?.ready.then(safeRefresh);
      window.addEventListener("load", safeRefresh, { once: true });

      disconnect = () => {
        window.clearTimeout(idle);
        window.removeEventListener("load", safeRefresh);
        observer?.disconnect();
      };
    };

    void start();

    return () => {
      cancelled = true;
      disconnect?.();
      // revert() on the matchMedia instance runs the per-query cleanups (which
      // put split headings back together); the context kills what is left.
      matchMediaInstance?.revert();
      context?.revert();
    };
  }, [pathname]);

  return null;
}
