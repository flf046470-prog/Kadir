"use client";

import Image from "next/image";
import { ConceptFilm } from "@/components/gallery/concept-film";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { getTrevelinSeason, SEASON_ORDER, TREVELIN_TIME_ZONE, type Season } from "./calendar";
import { seasonCopy } from "./copy";
import { SeasonEffects } from "./effects";
import styles from "./seasons.module.css";

const POSITION: Record<Season, string> = {
  spring: "0% 0%", summer: "100% 0%", autumn: "0% 100%", winter: "100% 100%",
};
const GALLERY = ["exterior-dusk.webp", "interior-living.webp", "exterior-night.webp", "bedroom-spa.webp"];
export const OFFICIAL_PATREON = "https://www.patreon.com/cw/Umut414";

function Arrow({ reverse = false }: { reverse?: boolean }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true" style={reverse ? { transform: "rotate(180deg)" } : undefined}><path d="M4 12h15m-6-6 6 6-6 6" /></svg>;
}

export function SeasonalHome({ locale, initialDate }: { locale: string; initialDate: string }) {
  const copy = seasonCopy(locale);
  const [now, setNow] = useState(initialDate);
  const [selected, setSelected] = useState<Season | null>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const heroRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const seasonButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const current = getTrevelinSeason(new Date(now));
  const season = selected ?? current;
  const active = !paused && !reduced && visible && tabVisible;
  const live = (path: string) => `/${locale}${path}`;

  useEffect(() => {
    const refresh = () => setNow(new Date().toISOString());
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const preference = () => setReduced(media.matches);
    const visibility = () => { setTabVisible(!document.hidden); if (!document.hidden) refresh(); };
    preference(); visibility();
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visibility);
    media.addEventListener("change", preference);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visibility);
      media.removeEventListener("change", preference);
    };
  }, []);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .01 });
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    if (!active) {
      hero.style.setProperty("--pan-x", "0px");
      hero.style.setProperty("--pan-y", "0px");
      hero.style.setProperty("--scroll-y", "0px");
      return;
    }
    let frame = 0;
    const scroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        const box = hero.getBoundingClientRect();
        hero.style.setProperty("--scroll-y", `${Math.min(Math.max(-box.top / box.height, 0), 1) * 46}px`);
        frame = 0;
      });
    };
    const pointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const box = hero.getBoundingClientRect();
      hero.style.setProperty("--pan-x", `${(event.clientX / box.width - .5) * -9}px`);
      hero.style.setProperty("--pan-y", `${((event.clientY - box.top) / box.height - .5) * -6}px`);
    };
    const leave = () => { hero.style.setProperty("--pan-x", "0px"); hero.style.setProperty("--pan-y", "0px"); };
    window.addEventListener("scroll", scroll, { passive: true });
    hero.addEventListener("pointermove", pointer, { passive: true });
    hero.addEventListener("pointerleave", leave);
    scroll();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scroll);
      hero.removeEventListener("pointermove", pointer);
      hero.removeEventListener("pointerleave", leave);
    };
  }, [active]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (galleryIndex === null || !dialog) return;
    if (!dialog.open) dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, [galleryIndex]);

  function chooseSeason(value: Season, fromCard = false) {
    setSelected(value);
    if (fromCard) {
      heroRef.current?.scrollIntoView({ behavior: reduced || paused ? "instant" : "smooth", block: "start" });
      seasonButtons.current[SEASON_ORDER.indexOf(value)]?.focus({ preventScroll: true });
    }
  }

  function seasonKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % 4;
    else if (event.key === "ArrowLeft") next = (index + 3) % 4;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 3;
    else return;
    event.preventDefault();
    setSelected(SEASON_ORDER[next]);
    seasonButtons.current[next]?.focus();
  }

  const closeGallery = () => { dialogRef.current?.close(); setGalleryIndex(null); };
  const moveGallery = (direction: number) => setGalleryIndex((index) => ((index ?? 0) + direction + GALLERY.length) % GALLERY.length);
  const formattedDate = new Intl.DateTimeFormat(locale, { timeZone: TREVELIN_TIME_ZONE, day: "2-digit", month: "short", year: "numeric" }).format(new Date(now));

  return (
    <div className={styles.home} data-season={season} data-motion-active={active}>
      <section ref={heroRef} className={styles.hero} aria-label="SkySphere" id="seasonal-landscape">
        <div className={styles.scene} aria-hidden="true">
          <div className={styles.world}>
            {SEASON_ORDER.map((value) => <div key={value} className={styles.seasonImage} data-active={season === value} style={{ backgroundPosition: POSITION[value] }} />)}
            <SeasonEffects season={season} active={active} className={styles.effects} />
          </div>
        </div>
        <div className={styles.scrim} />
        <aside className={styles.localDate}>
          <span className={styles.kicker}>{copy.now}</span>
          <time dateTime={now}>{formattedDate}</time>
          <span className={styles.liveSeason}><span />{copy.seasons[current].name}</span>
        </aside>

        <div className={styles.heroContent}>
          <p className={styles.kicker}>{copy.eyebrow}</p>
          <h1>SkySphere</h1>
          <p className={styles.subtitle}>Patagonia Underground</p>
          <p className={styles.intro}>{copy.intro}</p>
          <div className={styles.actions}>
            <a className={styles.primary} href={live("/project")}>{copy.project}<Arrow /></a>
            <a className={styles.secondary} href={live("/immersive")}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true"><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10" /></svg>{copy.immersive}</a>
          </div>
        </div>

        <div className={styles.heroBottom}>
          <div className={styles.seasonSwitcher}>
            <span className={styles.kicker}>{copy.choose}</span>
            <div className={styles.seasonButtons} role="group" aria-label={copy.choose}>
              {SEASON_ORDER.map((value, index) => <button key={value} ref={(node) => { seasonButtons.current[index] = node; }} type="button" aria-pressed={season === value} onClick={() => chooseSeason(value)} onKeyDown={(event) => seasonKeys(event, index)}><span className={styles.seasonNumber}>0{index + 1}</span><span>{copy.seasons[value].name}</span><span className={styles.seasonIndicator} /></button>)}
            </div>
            <div className={styles.switcherMeta}>
              <button type="button" className={styles.autoButton} aria-pressed={selected === null} onClick={() => { setNow(new Date().toISOString()); setSelected(null); }}><span className={styles.autoDot} />{copy.auto}<span>{selected === null ? copy.automatic : copy.selected}</span></button>
              <button type="button" className={styles.motionButton} disabled={reduced} aria-pressed={paused || reduced} aria-label={reduced ? copy.reduced : paused ? copy.play : copy.pause} onClick={() => setPaused((value) => !value)}>{paused || reduced ? <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m7 4 8 6-8 6z" /></svg> : <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" aria-hidden="true"><path d="M7 4v12M13 4v12" /></svg>}<span>{reduced ? copy.reduced : paused ? copy.play : copy.pause}</span></button>
            </div>
          </div>
          <div className={styles.seasonCaption} aria-live="polite" aria-atomic="true">
            <p className={styles.kicker}>{copy.seasons[season].period}</p>
            <p>{copy.seasons[season].title}</p>
            <span>{copy.seasons[season].note}</span>
          </div>
        </div>
        <p className={styles.imageCaption}>{copy.caption}</p>
      </section>

      <section className={styles.concept} id="seasonal-concept">
        <div><p className={styles.kicker}>{copy.conceptKicker}</p><h2>{copy.conceptTitle.split("\n").map((line) => <span key={line}>{line}</span>)}</h2></div>
        <div><p>{copy.conceptBody}</p><a className={styles.textLink} href={live("/project")}>{copy.project}<Arrow /></a></div>
        <div className={styles.conceptSeal} aria-hidden="true"><svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth=".7"><circle cx="50" cy="50" r="47" /><path d="M17 57h66M24 57a26 26 0 0 1 52 0M50 31v26M31 39l19 18 19-18M24 57v15h52V57M38 70v-8h24v8" /><path d="M17 79h66M23 83h54" opacity=".5" /></svg></div>
      </section>

      <section className={styles.seasonsSection} aria-labelledby="seasons-title">
        <div className={styles.sectionHeading}><div><p className={styles.kicker}>{copy.seasonsKicker}</p><h2 id="seasons-title">{copy.seasonsTitle}</h2></div><p>{copy.seasonsIntro}</p></div>
        <div className={styles.seasonCards}>
          {SEASON_ORDER.map((value, index) => <button type="button" key={value} className={styles.seasonCard} aria-pressed={season === value} aria-label={`${copy.seasons[value].name} — ${copy.experience}`} onClick={() => chooseSeason(value, true)}>
            <div className={styles.cardPhoto} style={{ "--season-position": POSITION[value] } as CSSProperties} />
            <div className={styles.cardVeil} />
            <div className={styles.cardTop}><span className={styles.kicker}>0{index + 1} / {copy.seasons[value].name}</span><span className={styles.cardCheck} aria-hidden="true">{season === value ? "●" : "○"}</span></div>
            <div className={styles.cardBody}><h3>{copy.seasons[value].title}</h3><span className={styles.cardPeriod}>{copy.seasons[value].period}</span><p>{copy.seasons[value].body}</p><span className={styles.cardCta}>{copy.experience}<span><Arrow /></span></span></div>
          </button>)}
        </div>
        <p className={styles.calendarNote}>{copy.calendar}</p>
      </section>

      <section className={styles.gallerySection} aria-labelledby="seasonal-gallery-title">
        <div className={styles.sectionHeading}><div><p className={styles.kicker}>{copy.galleryKicker}</p><h2 id="seasonal-gallery-title">{copy.galleryTitle}</h2></div><a className={styles.textLink} href={live("/gallery")}>{copy.gallery}<Arrow /></a></div>
        <div className={styles.galleryGrid}>{GALLERY.map((file, index) => <button type="button" key={file} className={styles.galleryCard} aria-haspopup="dialog" onClick={() => setGalleryIndex(index)}><div className={styles.galleryPhoto}><Image src={`/project/${file}`} alt={copy.galleryNames[index]} fill sizes="(max-width: 600px) 85vw, (max-width: 1000px) 45vw, 24vw" /></div><span><small>0{index + 1}</small>{copy.galleryNames[index]}<Arrow /></span></button>)}</div>
        <p className={styles.calendarNote}>{copy.galleryNote}</p>
        <ConceptFilm locale={locale} />
      </section>

      <section className={styles.support}>
        <div className={styles.supportBackdrop} style={{ backgroundPosition: POSITION[season] }} aria-hidden="true" />
        <div className={styles.supportContent}><p className={styles.kicker}>{copy.supportKicker}</p><h2>{copy.supportTitle}</h2><p>{copy.supportBody}</p><div className={styles.actions}><a className={styles.primary} href={live("/join")}>{copy.join}<Arrow /></a><a className={styles.secondary} href={OFFICIAL_PATREON} target="_blank" rel="noopener noreferrer">{copy.patreon}<Arrow /></a></div><small>{copy.disclaimer}</small></div>
      </section>

      <dialog ref={dialogRef} className={styles.lightbox} aria-label={copy.galleryTitle} onClose={() => setGalleryIndex(null)} onClick={(event) => { if (event.target === event.currentTarget) closeGallery(); }} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); moveGallery(-1); } if (event.key === "ArrowRight") { event.preventDefault(); moveGallery(1); } }}>
        <button type="button" className={styles.closeButton} aria-label={copy.close} onClick={closeGallery}><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
        {galleryIndex !== null && <><div className={styles.lightboxPhoto}><Image src={`/project/${GALLERY[galleryIndex]}`} alt={`${copy.galleryNames[galleryIndex]} — ${copy.galleryNote}`} fill sizes="90vw" /></div><div className={styles.lightboxControls}><button type="button" aria-label={copy.previous} onClick={() => moveGallery(-1)}><Arrow reverse /></button><p aria-live="polite">{copy.galleryNames[galleryIndex]}<span>{galleryIndex + 1} / {GALLERY.length}</span></p><button type="button" aria-label={copy.next} onClick={() => moveGallery(1)}><Arrow /></button></div><p className={styles.lightboxNote}>{copy.galleryNote}</p></>}
      </dialog>
    </div>
  );
}
