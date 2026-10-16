"use client";

import { useEffect, useRef } from "react";
import { SEASON_ORDER, type Season } from "./calendar";

export const ATLAS_URL = "/seasons/four-seasons-atlas.png";

/** Canvas 2D keeps the seasonal atmosphere available without WebGL or Three.js. */
export function SeasonEffects({ season, active, className }: {
  season: Season;
  active: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) return;
    if (!active) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    let frame = 0;
    let disposed = false;
    let width = 1;
    let height = 1;
    let last = 0;
    let start = 0;
    const image = new window.Image();
    const random = (index: number) => {
      const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
      return value - Math.floor(value);
    };
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      width = box.width;
      height = box.height;
      const density = Math.min(window.devicePixelRatio || 1, 1.25);
      canvas.width = Math.max(1, Math.round(width * density));
      canvas.height = Math.max(1, Math.round(height * density));
      context.setTransform(density, 0, 0, density, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const water = (time: number) => {
      if (!image.complete || !image.naturalWidth) return;
      const index = SEASON_ORDER.indexOf(season);
      const sourceW = image.naturalWidth / 2;
      const sourceH = image.naturalHeight / 2;
      const sourceX = (index % 2) * sourceW;
      const sourceY = Math.floor(index / 2) * sourceH;

      // A shoreline mask confines refraction to water; the house stays still.
      context.save();
      context.beginPath();
      const shore = [[.15,.39],[.25,.385],[.32,.413],[.48,.41],[.52,.452],[.58,.443],[.65,.463],[.78,.447],[.96,.47],[.93,.51],[.79,.555],[.52,.583],[.34,.551],[.25,.516],[.13,.49]];
      shore.forEach(([x,y], i) => i === 0 ? context.moveTo(x*width,y*height) : context.lineTo(x*width,y*height));
      context.closePath();
      context.clip();
      const strength = season === "winter" ? .55 : 1.8;
      for (let y = Math.floor(height * .38); y < height * .59; y += 2) {
        const shift = Math.sin(y * .19 + time * 1.9) * strength + Math.sin(y * .06 - time) * strength;
        context.drawImage(image, sourceX, sourceY + y / height * sourceH, sourceW, sourceH / height * 2,
          shift - 2, y, width + 4, 2);
      }
      // Long, faint sunlit crests give the water a slower second rhythm.
      context.strokeStyle = season === "winter" ? "rgba(208,230,255,.10)" : "rgba(255,231,196,.16)";
      context.lineWidth = .65;
      for (let i = 0; i < 28; i++) {
        const x = random(i + 4) * width;
        const y = height * (.4 + random(i + 61) * .17);
        const length = 10 + random(i + 91) * 55;
        const drift = Math.sin(time * .8 + i) * 9;
        context.beginPath();
        context.ellipse(x + drift, y, length, 1.4, 0, .05, Math.PI * .9);
        context.stroke();
      }
      context.restore();
    };

    const meadow = (time: number) => {
      if (season === "winter") return;
      for (let i = 0; i < 48; i++) {
        const x = random(i + 170) * width;
        const tall = (12 + random(i + 270) * 30) * Math.min(width / 1000, 1.5);
        const sway = Math.sin(time * 1.4 + i * .7) * tall * .2;
        context.strokeStyle = season === "autumn" ? "rgba(191,147,72,.35)" : "rgba(159,183,94,.36)";
        context.lineWidth = .8;
        context.beginPath();
        context.moveTo(x, height + 2);
        context.quadraticCurveTo(x + sway, height - tall * .5, x + sway * 1.8, height - tall);
        context.stroke();
      }
    };

    const flowers = (time: number) => {
      const scale = Math.min(width / 1100, 1.45);
      for (let i = 0; i < 13; i++) {
        // Keep the centre open, framing the architectural concept.
        const x = (i < 7 ? .015 + i * .029 : .83 + (i - 7) * .03) * width;
        const tall = (35 + random(i + 10) * 53) * scale;
        const sway = Math.sin(time * 1.1 + i) * tall * .12;
        const topX = x + sway;
        const topY = height - tall;
        const bloom = Math.max(.03, Math.min(1, (time - i * .11) / 2.5));
        context.strokeStyle = "rgba(111,145,69,.8)";
        context.lineWidth = 1.3 * scale;
        context.beginPath();
        context.moveTo(x, height);
        context.quadraticCurveTo(x, topY + tall * .3, topX, topY);
        context.stroke();
        context.save();
        context.translate(topX, topY);
        context.rotate(sway * .015);
        context.fillStyle = ["rgba(232,160,186,.9)", "rgba(227,214,231,.9)", "rgba(178,141,203,.9)"][i % 3];
        for (let petal = 0; petal < 5; petal++) {
          context.rotate(Math.PI * 2 / 5);
          context.beginPath();
          context.ellipse(0, -5 * scale * bloom, 3.4 * scale * bloom, 6.5 * scale * bloom, 0, 0, Math.PI * 2);
          context.fill();
        }
        context.fillStyle = "#dfb978";
        context.beginPath();
        context.arc(0, 0, 2.3 * scale * bloom, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }
    };

    const bees = (time: number) => {
      for (let i = 0; i < 3; i++) {
        const x = width * (.25 + i * .26 + Math.sin(time * .39 + i * 2) * .09);
        const y = height * (.72 + Math.sin(time * .9 + i) * .055 + i * .035);
        const size = (i === 1 ? 1 : .7) * Math.min(width / 1000, 1.4);
        context.save();
        context.translate(x, y);
        context.scale(size, size);
        context.rotate(Math.sin(time * 1.2 + i) * .25);
        context.fillStyle = "rgba(235,242,236,.72)";
        const wing = 2 + Math.abs(Math.sin(time * 32)) * 3;
        for (const side of [-1, 1]) {
          context.beginPath();context.ellipse(-1, side * 3.5, wing, 3, side * .5, 0, Math.PI * 2);context.fill();
        }
        context.fillStyle = "#d7ae53";
        context.beginPath();context.ellipse(0, 0, 5.8, 3.2, 0, 0, Math.PI * 2);context.fill();
        context.strokeStyle = "#342c21";context.lineWidth = 1.5;
        context.beginPath();context.moveTo(-2,-2.9);context.lineTo(-2,2.9);context.moveTo(1,-2.9);context.lineTo(1,2.9);context.stroke();
        context.fillStyle = "#302921";context.beginPath();context.arc(5,0,2.2,0,Math.PI*2);context.fill();
        context.restore();
      }
    };

    const particles = (time: number) => {
      const count = season === "winter" ? 100 : season === "autumn" ? 28 : 16;
      for (let i = 0; i < count; i++) {
        const depth = .4 + random(i + 100) * .8;
        const speed = season === "winter" ? .035 : .025;
        const x = ((random(i) + time * .012 * depth + Math.sin(time * .6 + i) * .018) % 1.1 - .05) * width;
        const y = ((random(i + 30) + time * speed * depth) % 1.1 - .05) * height;
        const radius = (1 + random(i + 50) * 2.3) * depth * Math.min(width / 1000, 1.6);
        context.save();context.translate(x, y);
        if (season === "winter") {
          context.fillStyle = `rgba(240,245,255,${.35 + depth * .4})`;
          context.beginPath();context.arc(0, 0, radius, 0, Math.PI*2);context.fill();
        } else if (season === "autumn") {
          context.rotate(time * (1 + depth) + i);
          context.scale(1, .4 + Math.abs(Math.sin(time + i)) * .6);
          context.fillStyle = ["#b85c2a", "#d89d44", "#9f432e", "#c77b35"][i % 4];
          context.beginPath();context.moveTo(-radius*3,0);
          context.bezierCurveTo(-radius,-radius*2.4,radius*2,-radius*2.4,radius*3,0);
          context.bezierCurveTo(radius,radius*2.4,-radius*2,radius*2.4,-radius*3,0);context.fill();
          context.strokeStyle="rgba(90,48,23,.65)";context.lineWidth=.5;context.beginPath();context.moveTo(-radius*3,0);context.lineTo(radius*3,0);context.stroke();
        } else {
          context.rotate(time * .5 + i);
          context.fillStyle = season === "spring" ? "rgba(247,184,202,.65)" : "rgba(255,236,166,.35)";
          context.beginPath();context.ellipse(0,0,radius*(season === "spring" ? 2 : .7),radius*.7,0,0,Math.PI*2);context.fill();
        }
        context.restore();
      }
    };

    const draw = (stamp: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(draw);
      if (stamp - last < 1000 / 30) return;
      if (!start) start = stamp;
      last = stamp;
      const time = (stamp - start) / 1000;
      context.clearRect(0, 0, width, height);
      water(time);
      meadow(time);
      if (season === "spring") { flowers(time); bees(time); }
      particles(time);
    };
    image.onload = () => { if (!disposed) frame = requestAnimationFrame(draw); };
    image.onerror = () => { if (!disposed) frame = requestAnimationFrame(draw); };
    image.src = ATLAS_URL;

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      image.onload = null;
      image.onerror = null;
    };
  }, [season, active]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" data-season-effects={season} />;
}
