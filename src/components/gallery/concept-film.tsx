"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./concept-film.module.css";

const COPY = {
  en: {
    label: "Architectural concept · 5 second film",
    title: "A winter vision of SkySphere.",
    body: "An atmospheric design study. Architectural visualization with an illustrative landscape.",
    play: "Play the SkySphere concept film",
    download: "Open the video",
    error: "The video could not be played. You can open the MP4 directly.",
  },
  tr: {
    label: "Mimari konsept · 5 saniyelik film",
    title: "SkySphere’in kış vizyonu.",
    body: "Kış atmosferinde bir tasarım çalışması. Mimari görselleştirme; temsili manzara.",
    play: "SkySphere konsept filmini oynat",
    download: "Videoyu aç",
    error: "Video oynatılamadı. MP4 dosyasını doğrudan açabilirsin.",
  },
  es: {
    label: "Concepto arquitectónico · Película de 5 segundos",
    title: "Una visión invernal de SkySphere.",
    body: "Un estudio de diseño con atmósfera invernal. Visualización arquitectónica con un paisaje ilustrativo.",
    play: "Reproducir la película conceptual de SkySphere",
    download: "Abrir el vídeo",
    error: "No se pudo reproducir el vídeo. Puedes abrir el MP4 directamente.",
  },
};

export function ConceptFilm({ locale }: { locale: string }) {
  const copy = COPY[locale as keyof typeof COPY] ?? COPY.en;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) video.pause();
    });
    const onVisibility = () => { if (document.hidden) video.pause(); };
    observer.observe(video);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <figure className={styles.film}>
      <div className={styles.stage}>
        <video
          ref={videoRef}
          className={styles.video}
          controls
          playsInline
          preload="none"
          width="720"
          height="1280"
          poster="/project/skysphere-concept-film-poster.webp"
          aria-label={copy.play}
          aria-describedby="concept-film-caption"
          onError={() => setFailed(true)}
        >
          <source src="/project/skysphere-concept-film.mp4" type="video/mp4" onError={() => setFailed(true)} />
          <a href="/project/skysphere-concept-film.mp4">{copy.download}</a>
        </video>
      </div>
      <figcaption className={styles.caption} id="concept-film-caption">
        <span className={styles.label}>{copy.label}</span>
        <h3>{copy.title}</h3>
        <p>{copy.body}</p>
        {failed && <p role="alert">{copy.error}</p>}
        <a href="/project/skysphere-concept-film.mp4" target="_blank" rel="noopener noreferrer">
          {copy.download}<span aria-hidden="true">↗</span>
        </a>
      </figcaption>
    </figure>
  );
}
