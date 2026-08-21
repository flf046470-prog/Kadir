"use client";

import { useEffect, useRef } from "react";

/**
 * The cordillera at dusk, drawn rather than photographed.
 *
 * The site has no licensed photograph of this valley yet, and it will not
 * borrow a stock mountain and imply it is Trevelin. So the range is generated:
 * ridge lines from layered value noise, snow above a snowline, aerial haze
 * thickening with distance, and fog that drifts through the valleys. It reads
 * as the Andean west of Chubut — steep young rock, snow late into the season,
 * forest on the lower slopes — without claiming to be a specific photograph.
 *
 * Cost is one canvas: the landscape is drawn once into an offscreen buffer,
 * and each frame only blits that buffer and lays the drifting fog over it.
 */

/* ── noise ────────────────────────────────────────────────────────────── */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1D value noise over a fixed table — deterministic for a given seed. */
function makeNoise(seed: number) {
  const random = mulberry32(seed);
  const table = Array.from({ length: 512 }, () => random());
  return (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = table[((i % 512) + 512) % 512];
    const b = table[(((i + 1) % 512) + 512) % 512];
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  };
}

/** Ridged fractal noise: the sharp crests a young range actually has. */
function ridgeProfile(noise: (x: number) => number, x: number, roughness: number) {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let norm = 0;
  for (let octave = 0; octave < 5; octave++) {
    const n = Math.abs(noise(x * frequency) * 2 - 1);
    sum += (1 - n) * amplitude;
    norm += amplitude;
    amplitude *= roughness;
    frequency *= 2.13;
  }
  return sum / norm;
}

/* ── the range ────────────────────────────────────────────────────────── */

type Layer = {
  /** Horizon height as a fraction of the canvas. */
  base: number;
  /** Peak height as a fraction of the canvas. */
  amplitude: number;
  /** How much the ridge wanders horizontally. */
  scale: number;
  roughness: number;
  top: string;
  bottom: string;
  /** Fraction of the layer's own height above which snow lies. */
  snowline?: number;
  /** Haze laid over everything behind this layer. */
  haze: number;
  seed: number;
};

const LAYERS: Layer[] = [
  // The border range: high, sharp, still holding snow.
  { base: 0.7, amplitude: 0.34, scale: 1.7, roughness: 0.54, top: "#69808a", bottom: "#42535b", snowline: 0.74, haze: 0.26, seed: 11 },
  { base: 0.78, amplitude: 0.26, scale: 2.6, roughness: 0.52, top: "#46565c", bottom: "#2c393e", snowline: 0.86, haze: 0.2, seed: 27 },
  { base: 0.81, amplitude: 0.23, scale: 3.9, roughness: 0.49, top: "#3a4746", bottom: "#232c2b", haze: 0.17, seed: 43 },
  { base: 0.87, amplitude: 0.16, scale: 5.8, roughness: 0.47, top: "#232b28", bottom: "#161d1b", haze: 0.1, seed: 61 },
  { base: 0.93, amplitude: 0.1, scale: 8.4, roughness: 0.45, top: "#131917", bottom: "#0b0f0e", haze: 0, seed: 79 },
];

function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number) {
  /* Sky: night at the top, the last of the light along the ridge line. */
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#070b0e");
  sky.addColorStop(0.28, "#0d151c");
  sky.addColorStop(0.5, "#1d2a33");
  sky.addColorStop(0.66, "#4a5450");
  sky.addColorStop(0.78, "#8a7b5e");
  sky.addColorStop(1, "#9c8560");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  /* Alpenglow behind the range, where the sun has just gone. */
  const glow = ctx.createRadialGradient(w * 0.7, h * 0.6, 0, w * 0.7, h * 0.6, h * 0.8);
  glow.addColorStop(0, "rgba(224,150,88,0.30)");
  glow.addColorStop(0.45, "rgba(190,120,74,0.10)");
  glow.addColorStop(1, "rgba(190,120,74,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  /* A few stars, only in the darkest band of sky. */
  const starRandom = mulberry32(7);
  ctx.save();
  for (let i = 0; i < 90; i++) {
    const x = starRandom() * w;
    const y = starRandom() * h * 0.4;
    const a = (1 - y / (h * 0.4)) * 0.5 * starRandom();
    ctx.fillStyle = `rgba(226,232,228,${a.toFixed(3)})`;
    ctx.fillRect(x, y, 1.2, 1.2);
  }
  ctx.restore();

  for (const layer of LAYERS) {
    const noise = makeNoise(layer.seed);
    const baseY = h * layer.base;
    const peak = h * layer.amplitude;
    const step = Math.max(2, Math.round(w / 420));

    // The ridge line, sampled once and reused for the fill and the snow.
    const points: [number, number][] = [];
    for (let x = 0; x <= w + step; x += step) {
      const t = (x / w) * layer.scale;
      const y = baseY - ridgeProfile(noise, t, layer.roughness) * peak;
      points.push([x, y]);
    }

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.lineTo(w, h);
    ctx.closePath();

    // Local gradient: each ridge shades within its own height instead of
    // washing a pale tone across everything below it.
    const fill = ctx.createLinearGradient(0, baseY - peak, 0, baseY + peak * 0.35);
    fill.addColorStop(0, layer.top);
    fill.addColorStop(1, layer.bottom);
    ctx.fillStyle = fill;
    ctx.fill();

    /* Snow: held inside the ridge, thinning as it runs down the faces. */
    if (layer.snowline !== undefined) {
      const snowY = baseY - peak * layer.snowline;
      // A band between the crest and a ragged lower edge: snow lies on the
      // tops and runs a little way down the faces, nowhere else.
      const lower = points.map(([x, y]) => {
        if (y >= snowY) return [x, y] as [number, number];
        const reach = (snowY - y) * (0.15 + noise(x * 0.07) * 0.5);
        return [x, y + reach] as [number, number];
      });

      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (const [x, y] of points) ctx.lineTo(x, y);
      for (let i = lower.length - 1; i >= 0; i--) ctx.lineTo(lower[i][0], lower[i][1]);
      ctx.closePath();

      const snow = ctx.createLinearGradient(0, baseY - peak, 0, snowY);
      snow.addColorStop(0, "rgba(240,244,242,0.92)");
      snow.addColorStop(0.6, "rgba(206,217,218,0.55)");
      snow.addColorStop(1, "rgba(184,196,198,0.08)");
      ctx.fillStyle = snow;
      ctx.fill();
    }

    /* Aerial perspective: haze thickens over everything already drawn. */
    if (layer.haze > 0) {
      const haze = ctx.createLinearGradient(0, baseY - peak * 0.9, 0, baseY + peak * 0.5);
      haze.addColorStop(0, "rgba(126,140,143,0)");
      haze.addColorStop(0.65, `rgba(126,140,143,${(layer.haze * 0.75).toFixed(3)})`);
      haze.addColorStop(1, `rgba(126,140,143,${layer.haze})`);
      ctx.fillStyle = haze;
      ctx.fillRect(0, baseY - peak * 0.9, w, peak * 1.4);
    }
  }

  /* The near shoulder: the meadow the house is cut into. */
  const shoulderNoise = makeNoise(97);
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w + 4; x += 4) {
    const y = h * 0.93 - Math.sin((x / w) * Math.PI * 1.2) * h * 0.02 - shoulderNoise((x / w) * 6) * h * 0.015;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  const ground = ctx.createLinearGradient(0, h * 0.88, 0, h);
  ground.addColorStop(0, "#141a17");
  ground.addColorStop(1, "#0b0f0d");
  ctx.fillStyle = ground;
  ctx.fill();

  /* One lit window in the hillside — the project, at the scale it deserves. */
  const hx = w * 0.72;
  const hy = h * 0.925;
  const lamp = ctx.createRadialGradient(hx, hy, 0, hx, hy, Math.max(60, w * 0.06));
  lamp.addColorStop(0, "rgba(232,184,120,0.5)");
  lamp.addColorStop(0.4, "rgba(232,184,120,0.12)");
  lamp.addColorStop(1, "rgba(232,184,120,0)");
  ctx.fillStyle = lamp;
  ctx.fillRect(hx - w * 0.1, hy - h * 0.09, w * 0.2, h * 0.14);
  ctx.beginPath();
  ctx.ellipse(hx, hy, Math.max(9, w * 0.009), Math.max(4, h * 0.005), 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(240,201,146,0.75)";
  ctx.fill();
}

/** Fine grain, so large dark gradients do not band on cheap panels. */
function drawGrain(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const tile = 128;
  const image = ctx.createImageData(tile, tile);
  const random = mulberry32(5);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = 128 + (random() - 0.5) * 40;
    image.data[i] = v;
    image.data[i + 1] = v;
    image.data[i + 2] = v;
    image.data[i + 3] = 12;
  }
  const patch = document.createElement("canvas");
  patch.width = tile;
  patch.height = tile;
  patch.getContext("2d")?.putImageData(image, 0, 0);
  const pattern = ctx.createPattern(patch, "repeat");
  if (!pattern) return;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
}

export function AndesScene({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let running = true;
    let scene: HTMLCanvasElement | null = null;
    let width = 0;
    let height = 0;

    const build = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      // Phones gain nothing from a 3× buffer of a soft landscape.
      const dpr = Math.min(window.devicePixelRatio || 1, rect.width < 700 ? 1.5 : 2);
      width = Math.round(rect.width * dpr);
      height = Math.round(rect.height * dpr);
      canvas.width = width;
      canvas.height = height;

      scene = document.createElement("canvas");
      scene.width = width;
      scene.height = height;
      const sceneCtx = scene.getContext("2d", { alpha: false });
      if (!sceneCtx) return;
      drawScene(sceneCtx, width, height);
      drawGrain(sceneCtx, width, height);
      paint(0);
    };

    /** Blit the landscape, then lay the drifting fog over it. */
    const paint = (time: number) => {
      if (!scene) return;
      ctx.drawImage(scene, 0, 0);

      const bands = width < 900 ? 2 : 3;
      for (let i = 0; i < bands; i++) {
        const y = height * (0.66 + i * 0.09);
        const drift = ((time / (26000 + i * 9000)) % 1) * width * 2 - width * 0.5;
        const band = ctx.createLinearGradient(drift, 0, drift + width * 1.2, 0);
        band.addColorStop(0, "rgba(150,164,166,0)");
        band.addColorStop(0.35, `rgba(150,164,166,${0.05 + i * 0.015})`);
        band.addColorStop(0.6, `rgba(160,172,172,${0.07 + i * 0.02})`);
        band.addColorStop(1, "rgba(150,164,166,0)");
        ctx.fillStyle = band;
        ctx.fillRect(0, y - height * 0.06, width, height * 0.12);
      }
    };

    const loop = (time: number) => {
      if (!running) return;
      paint(time);
      frame = requestAnimationFrame(loop);
    };

    build();
    if (!still.matches) frame = requestAnimationFrame(loop);

    // Stop drawing whenever the hero is off screen or the tab is hidden.
    const observer = new IntersectionObserver(
      ([entry]) => {
        const active = entry.isIntersecting && !still.matches && !document.hidden;
        if (active && !running) {
          running = true;
          frame = requestAnimationFrame(loop);
        } else if (!active && running) {
          running = false;
          cancelAnimationFrame(frame);
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(canvas);

    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(build, 220);
    };
    window.addEventListener("resize", onResize);

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      observer.disconnect();
      scene = null;
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
