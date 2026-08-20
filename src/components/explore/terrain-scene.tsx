"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type Landmark = {
  id: string;
  title: string;
  body: string;
  /** Position in scene units: x runs west→east, z runs north→south. */
  x: number;
  z: number;
  color: number;
};

/* ── terrain generation ───────────────────────────────────────────────── */

/** Deterministic hash noise — no dependency, and the same landscape every load. */
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function smoothNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);

  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function fbm(x: number, y: number, octaves = 5): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * smoothNoise(x * frequency, y * frequency);
    frequency *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

const SIZE = 160;
const SEGMENTS = 176;
const WATER_LEVEL = 1.1;

/** Where the concept house sits, and the shelf that is levelled for it. */
export const SITE = { x: 2, z: -4, radius: 13 };

/**
 * A conceptual Andean valley: a high range along the western edge, foothills,
 * a river valley running north to south, and a lake basin in the east.
 */
function rawElevation(x: number, z: number): number {
  const nx = x / SIZE;
  const nz = z / SIZE;

  // Western cordillera: rises steeply toward -x.
  const range = Math.max(0, -nx - 0.05) * 2.1;
  const ridge = Math.pow(range, 1.35) * 48 * (0.75 + fbm(nx * 3 + 11, nz * 3 + 4, 4) * 0.7);

  // Rolling foothills across the whole plate.
  const hills = fbm(nx * 4.5 + 3, nz * 4.5 + 7) * 12;

  // River valley: a soft trough running north–south near x = 0.18.
  const valley = Math.exp(-Math.pow((nx - 0.18) * 7.5, 2)) * 6.5;

  // Lake basin in the south-east.
  const basin = Math.exp(-(Math.pow((nx - 0.34) * 5.2, 2) + Math.pow((nz - 0.3) * 5.2, 2))) * 8;

  // The base lifts the whole plate clear of the water line; only the river
  // trough and the lake basin are allowed to dig below it.
  return Math.max(-2.5, ridge + hills - valley - basin + 3.4);
}

/** The building platform, cut level into the slope the way a real one would be. */
const SITE_HEIGHT = rawElevation(SITE.x, SITE.z);

function elevation(x: number, z: number): number {
  const raw = rawElevation(x, z);
  const distance = Math.hypot(x - SITE.x, z - SITE.z);
  if (distance > SITE.radius) return raw;
  // Smooth the pad into the surrounding ground rather than leaving a step.
  const t = distance / SITE.radius;
  const blend = t * t * (3 - 2 * t);
  return SITE_HEIGHT * (1 - blend) + raw * blend;
}

const COLOR_WATERLINE = new THREE.Color("#3f5a52");
const COLOR_MEADOW = new THREE.Color("#5d7048");
const COLOR_FOREST = new THREE.Color("#2f4433");
const COLOR_ROCK = new THREE.Color("#4a4c47");
const COLOR_SNOW = new THREE.Color("#dfe4e0");

function colorForHeight(height: number, target: THREE.Color): THREE.Color {
  if (height < WATER_LEVEL + 0.5) return target.copy(COLOR_WATERLINE);
  if (height < 5) return target.copy(COLOR_MEADOW).lerp(COLOR_FOREST, (height - 1.6) / 3.4);
  if (height < 14) return target.copy(COLOR_FOREST).lerp(COLOR_ROCK, (height - 5) / 9);
  return target.copy(COLOR_ROCK).lerp(COLOR_SNOW, Math.min(1, (height - 14) / 11));
}

/* ── the house ────────────────────────────────────────────────────────── */

const HOUSE_RADIUS = 8.5;
const HOUSE_HEIGHT = 3.6;
/** The open, glazed face looks east-north-east, down the valley. */
const FACE_START = -Math.PI * 0.42;
const FACE_LENGTH = Math.PI * 0.84;

/**
 * The design concept as geometry: a circular plan cut into the shelf, its roof
 * returned to meadow, a glazed dome over the courtyard and one open face to the
 * valley. It is the concept drawn in three dimensions — not a built structure,
 * and not an engineered model.
 */
function buildHouse(): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];

  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const concrete = track(
    new THREE.MeshStandardMaterial({ color: 0x76756c, roughness: 0.9, metalness: 0 }),
  );
  const meadow = track(
    new THREE.MeshStandardMaterial({ color: 0x5f7349, roughness: 1, metalness: 0 }),
  );
  const glass = track(
    new THREE.MeshStandardMaterial({
      color: 0x9fc0cd,
      roughness: 0.08,
      metalness: 0.35,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    }),
  );
  const frame = track(
    new THREE.MeshStandardMaterial({ color: 0xb9c6cc, roughness: 0.5, metalness: 0.4 }),
  );
  const warmFloor = track(
    new THREE.MeshStandardMaterial({
      color: 0x2a221b,
      emissive: 0xd98b52,
      emissiveIntensity: 0.45,
      roughness: 1,
    }),
  );

  // Buried volume: the retaining drum that holds the earth back.
  const drum = new THREE.Mesh(
    track(new THREE.CylinderGeometry(HOUSE_RADIUS, HOUSE_RADIUS + 0.5, HOUSE_HEIGHT, 48)),
    concrete,
  );
  drum.position.y = HOUSE_HEIGHT / 2;
  group.add(drum);

  // Interior floor, lit from within at dusk.
  const floor = new THREE.Mesh(
    track(new THREE.CircleGeometry(HOUSE_RADIUS - 0.4, 48)),
    warmFloor,
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.35;
  group.add(floor);

  // The meadow continues over the roof — an annulus, open at the courtyard.
  const roof = new THREE.Mesh(
    track(new THREE.RingGeometry(3.1, HOUSE_RADIUS + 0.5, 48)),
    meadow,
  );
  roof.rotation.x = -Math.PI / 2;
  roof.position.y = HOUSE_HEIGHT + 0.02;
  group.add(roof);

  // Glazed dome over the central courtyard.
  const dome = new THREE.Mesh(
    track(new THREE.SphereGeometry(3.1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2)),
    glass,
  );
  dome.position.y = HOUSE_HEIGHT;
  group.add(dome);

  const domeFrame = new THREE.Mesh(
    track(new THREE.SphereGeometry(3.14, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2)),
    track(new THREE.MeshBasicMaterial({ color: 0xdae6ea, wireframe: true, transparent: true, opacity: 0.75 })),
  );
  domeFrame.position.y = HOUSE_HEIGHT;
  group.add(domeFrame);

  // The open face: full-height glazing across one arc of the drum.
  const glazing = new THREE.Mesh(
    track(
      new THREE.CylinderGeometry(
        HOUSE_RADIUS + 0.06,
        HOUSE_RADIUS + 0.06,
        HOUSE_HEIGHT - 0.3,
        40,
        1,
        true,
        FACE_START,
        FACE_LENGTH,
      ),
    ),
    glass,
  );
  glazing.position.y = (HOUSE_HEIGHT - 0.3) / 2 + 0.15;
  group.add(glazing);

  // Mullions, so the glazed face reads as a wall of glass rather than a gap.
  const mullionGeometry = track(new THREE.BoxGeometry(0.12, HOUSE_HEIGHT - 0.3, 0.12));
  for (let i = 0; i <= 7; i++) {
    const angle = FACE_START + (FACE_LENGTH * i) / 7;
    const mullion = new THREE.Mesh(mullionGeometry, frame);
    mullion.position.set(
      Math.cos(angle) * (HOUSE_RADIUS + 0.06),
      (HOUSE_HEIGHT - 0.3) / 2 + 0.15,
      Math.sin(angle) * (HOUSE_RADIUS + 0.06),
    );
    group.add(mullion);
  }

  // Terrace and fire pit on the open side.
  const terrace = new THREE.Mesh(
    track(new THREE.RingGeometry(HOUSE_RADIUS + 0.6, HOUSE_RADIUS + 4.2, 40, 1, FACE_START, FACE_LENGTH)),
    track(new THREE.MeshStandardMaterial({ color: 0x585953, roughness: 0.95 })),
  );
  terrace.rotation.x = -Math.PI / 2;
  terrace.position.y = 0.06;
  group.add(terrace);

  const fireAngle = FACE_START + FACE_LENGTH / 2;
  const fire = new THREE.Mesh(
    track(new THREE.CircleGeometry(0.9, 20)),
    track(
      new THREE.MeshStandardMaterial({
        color: 0x1a120c,
        emissive: 0xff8a3d,
        emissiveIntensity: 1.6,
        roughness: 1,
      }),
    ),
  );
  fire.rotation.x = -Math.PI / 2;
  fire.position.set(Math.cos(fireAngle) * (HOUSE_RADIUS + 2.6), 0.12, Math.sin(fireAngle) * (HOUSE_RADIUS + 2.6));
  group.add(fire);

  // Two small warm lights: one under the dome, one at the fire.
  const interior = new THREE.PointLight(0xffb570, 15, 30, 2);
  interior.position.set(0, 1.8, 0);
  group.add(interior);

  const hearth = new THREE.PointLight(0xff8a3d, 14, 18, 2);
  hearth.position.set(fire.position.x, 1, fire.position.z);
  group.add(hearth);

  return {
    group,
    dispose: () => {
      for (const item of disposables) item.dispose();
    },
  };
}

/* ── component ────────────────────────────────────────────────────────── */

export default function TerrainScene({
  landmarks,
  hintLabel,
  onSelect,
  selectedId,
}: {
  landmarks: Landmark[];
  hintLabel: string;
  onSelect: (id: string | null) => void;
  selectedId: string | null;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const selectRef = useRef(onSelect);

  // Kept in a ref so a new callback identity does not tear down the scene.
  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0e1311, 150, 340);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 800);
    camera.position.set(112, 74, 126);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(mount.clientWidth, mount.clientHeight, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 70;
    controls.maxDistance = 280;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.enablePan = false;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.target.set(0, 2, 0);

    // ── lighting: low western sun, cold sky bounce ──────────────────────
    const sun = new THREE.DirectionalLight(0xffd9a8, 2.1);
    sun.position.set(-120, 70, 40);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0x9fc0cd, 0x1b2019, 1.15));

    // ── terrain ─────────────────────────────────────────────────────────
    const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(position.count * 3);
    const scratch = new THREE.Color();

    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const height = elevation(x, z);
      position.setY(i, height);
      colorForHeight(height, scratch);
      colors[i * 3] = scratch.r;
      colors[i * 3 + 1] = scratch.g;
      colors[i * 3 + 2] = scratch.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const terrain = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.95,
        metalness: 0,
        flatShading: true,
      }),
    );
    scene.add(terrain);

    // ── water ───────────────────────────────────────────────────────────
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE, SIZE),
      new THREE.MeshStandardMaterial({
        color: 0x2c4a55,
        transparent: true,
        opacity: 0.82,
        roughness: 0.15,
        metalness: 0.25,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_LEVEL;
    scene.add(water);

    // ── the concept house, on its levelled shelf ────────────────────────
    const house = buildHouse();
    house.group.position.set(SITE.x, elevation(SITE.x, SITE.z), SITE.z);
    scene.add(house.group);

    // ── landmark markers ────────────────────────────────────────────────
    const markerGroup = new THREE.Group();
    const markerGeometry = new THREE.ConeGeometry(1.6, 5, 6);
    const markers: THREE.Mesh[] = [];

    for (const landmark of landmarks) {
      const y = Math.max(elevation(landmark.x, landmark.z), WATER_LEVEL) + 4;
      const marker = new THREE.Mesh(
        markerGeometry,
        new THREE.MeshStandardMaterial({
          color: landmark.color,
          emissive: landmark.color,
          emissiveIntensity: 0.45,
          roughness: 0.4,
        }),
      );
      marker.position.set(landmark.x, y, landmark.z);
      marker.rotation.x = Math.PI;
      marker.userData.id = landmark.id;
      markers.push(marker);
      markerGroup.add(marker);
    }
    scene.add(markerGroup);

    // ── interaction ─────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt = { x: 0, y: 0, time: 0 };

    // Selecting a marker eases the orbit toward it instead of jumping.
    const homeTarget = new THREE.Vector3(0, 2, 0);
    const desiredTarget = homeTarget.clone();
    let desiredDistance = camera.position.distanceTo(controls.target);

    const focusOn = (id: string | null) => {
      const landmark = landmarks.find((l) => l.id === id);
      if (!landmark) {
        desiredTarget.copy(homeTarget);
        desiredDistance = 175;
        return;
      }
      desiredTarget.set(
        landmark.x,
        Math.max(elevation(landmark.x, landmark.z), WATER_LEVEL) + 3,
        landmark.z,
      );
      // The house is worth getting close to; the rest read better from further out.
      desiredDistance = landmark.id === "home" ? 42 : 95;
    };

    const onPointerDown = (event: PointerEvent) => {
      downAt = { x: event.clientX, y: event.clientY, time: performance.now() };
    };

    const onPointerUp = (event: PointerEvent) => {
      // Ignore the pointer-up that ends a drag; only treat taps as selection.
      const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
      if (moved > 8 || performance.now() - downAt.time > 600) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(markers, false)[0];
      const id = hit ? (hit.object.userData.id as string) : null;
      controls.autoRotate = id === null;
      focusOn(id);
      selectRef.current(id);
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    // ── resize ──────────────────────────────────────────────────────────
    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    // ── loop, paused whenever the canvas is off-screen or the tab is hidden ─
    let frame = 0;
    let visible = true;
    const clock = new THREE.Clock();

    const render = () => {
      frame = requestAnimationFrame(render);
      if (!visible || document.hidden) return;
      const time = clock.getElapsedTime();
      water.position.y = WATER_LEVEL + Math.sin(time * 0.6) * 0.06;
      for (const marker of markers) {
        marker.position.y += Math.sin(time * 1.4 + marker.position.x) * 0.004;
      }
      // Ease the orbit toward whatever is focused; a drag still wins, because
      // OrbitControls writes the final position after this.
      controls.target.lerp(desiredTarget, 0.045);
      const offset = camera.position.clone().sub(controls.target);
      const distance = offset.length();
      const eased = distance + (desiredDistance - distance) * 0.045;
      camera.position.copy(controls.target).add(offset.setLength(eased));

      controls.update();
      renderer.render(scene, camera);
    };
    render();
    setReady(true);

    const visibility = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { threshold: 0.05 },
    );
    visibility.observe(mount);

    return () => {
      cancelAnimationFrame(frame);
      visibility.disconnect();
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      house.dispose();
      geometry.dispose();
      markerGeometry.dispose();
      terrain.material.dispose();
      water.geometry.dispose();
      (water.material as THREE.Material).dispose();
      for (const marker of markers) (marker.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [landmarks]);

  const selected = landmarks.find((l) => l.id === selectedId);

  return (
    <div className="relative h-full w-full">
      <div ref={mountRef} className="h-full w-full" />

      {!ready ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="label text-fog/60">…</span>
        </div>
      ) : null}

      <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[0.65rem] tracking-[0.18em] text-fog/50 uppercase">
        {hintLabel}
      </p>

      {selected ? (
        <div className="absolute start-4 top-4 max-w-xs rounded-sm border border-fog/20 bg-basalt/92 p-5 backdrop-blur-sm">
          <div className="flex items-start justify-between gap-4">
            <p className="label text-ember">{selected.title}</p>
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="-mt-1 text-fog transition-colors hover:text-snow"
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-mist">{selected.body}</p>
        </div>
      ) : null}
    </div>
  );
}
