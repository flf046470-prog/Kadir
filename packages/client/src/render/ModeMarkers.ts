import * as THREE from 'three';
import type { ModeMarkerView } from '@kc/core';

/**
 * The places a mode is about: King of the Hill's ring, Roo Ball's goals and its corner flags.
 *
 * Driven from `ModeStateView.markers`, which the server broadcasts twice a second, so a player who
 * joins mid-round sees them at once. The hill used to exist only as a `checkpoint` event that
 * nothing drew — a mode about standing in a ring with no ring on screen.
 *
 * Unlit and additive where it glows, like the checkpoint rings and portal veils: stylised gameplay
 * markers rather than physical objects, legible from across a map in any light and at any tier.
 */

const TEAM_COLOURS = { red: 0xff5a4f, blue: 0x3d8bff } as const;
/** The colourblind-safe pair, the same one the role rings use. */
const TEAM_COLOURS_SAFE = { red: 0xff8c1a, blue: 0x2b6cff } as const;
const HILL_COLOUR = 0xffd166;
const BEAM_HEIGHT = 9;
const POST_RADIUS = 0.07;
const FLAG_HEIGHT = 1.5;

interface Slot {
  group: THREE.Group;
  kind: ModeMarkerView['kind'];
  ring: THREE.Mesh;
  beam: THREE.Mesh | null;
  frame: THREE.Mesh[];
  materials: THREE.Material[];
}

export class ModeMarkers {
  readonly group = new THREE.Group();
  private readonly slots: Slot[] = [];
  private readonly ringGeometry = new THREE.RingGeometry(0.93, 1, 64);
  private readonly beamGeometry = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true);
  private readonly postGeometry = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, 1, 10);
  /** A pennant: a right triangle hanging off the top of a corner post. */
  private readonly flagGeometry = (() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.55, -0.18);
    shape.lineTo(0, -0.36);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  })();

  /** Draw exactly these markers; anything left over from a previous state is hidden. */
  update(markers: readonly ModeMarkerView[] | undefined, colorblindSafe = false): void {
    const list = markers ?? [];
    list.forEach((marker, i) => {
      let slot = this.slots[i];
      if (!slot || slot.kind !== marker.kind) {
        if (slot) this.release(slot);
        slot = marker.kind === 'hill' ? this.makeHill() : marker.kind === 'goal' ? this.makeGoal() : this.makePitch();
        this.slots[i] = slot;
        this.group.add(slot.group);
      }
      this.place(slot, marker, colorblindSafe);
    });
    for (let i = list.length; i < this.slots.length; i++) (this.slots[i] as Slot).group.visible = false;
  }

  /** A slow breath on the glow, so a marker reads as live rather than painted on. */
  animate(time: number): void {
    const pulse = 0.75 + 0.25 * Math.sin(time * 2.4);
    for (const slot of this.slots) {
      if (slot.kind === 'pitch') continue;
      (slot.ring.material as THREE.MeshBasicMaterial).opacity = 0.85 * pulse;
      if (slot.beam) (slot.beam.material as THREE.MeshBasicMaterial).opacity = 0.16 * pulse;
    }
  }

  private place(slot: Slot, marker: ModeMarkerView, colorblindSafe: boolean): void {
    slot.group.visible = true;
    slot.group.position.set(marker.x, marker.y, marker.z);
    slot.group.rotation.y = marker.yaw ?? 0;
    const r = marker.radius;
    slot.ring.scale.set(r, r, 1);
    slot.ring.position.y = 0.06;
    if (slot.beam) {
      slot.beam.scale.set(r, BEAM_HEIGHT, r);
      slot.beam.position.y = BEAM_HEIGHT / 2;
    }
    if (marker.kind === 'pitch') {
      // Corner flags, not painted lines: the pitch lies on whatever ground the map has there, and a
      // post stands up out of a slope where a line would sink into it. Each end's flags wear the
      // colour of the team whose goal is at that end — local −Z is red's end (`goals[0]`).
      const hl = marker.halfLength ?? 10;
      const hw = marker.halfWidth ?? 8;
      const palette = colorblindSafe ? TEAM_COLOURS_SAFE : TEAM_COLOURS;
      slot.frame.forEach((post, i) => {
        const sx = i % 2 === 0 ? -1 : 1;
        const sz = i < 2 ? -1 : 1;
        post.scale.set(1, FLAG_HEIGHT, 1);
        post.position.set(sx * hw, FLAG_HEIGHT / 2, sz * hl);
        const flag = post.children[0] as THREE.Mesh | undefined;
        if (flag) (flag.material as THREE.MeshBasicMaterial).color.setHex(sz < 0 ? palette.red : palette.blue);
      });
      slot.ring.visible = false;
      return;
    }
    if (marker.kind === 'goal') {
      const colour = marker.team ? (colorblindSafe ? TEAM_COLOURS_SAFE : TEAM_COLOURS)[marker.team] : 0xffffff;
      (slot.ring.material as THREE.MeshBasicMaterial).color.setHex(colour);
      // Posts either side of the mouth, across the line to the centre spot, and a crossbar.
      const height = 2.4;
      const [left, right, bar] = slot.frame as [THREE.Mesh, THREE.Mesh, THREE.Mesh];
      left.scale.set(1, height, 1);
      left.position.set(-r, height / 2, 0);
      right.scale.set(1, height, 1);
      right.position.set(r, height / 2, 0);
      bar.scale.set(1, r * 2, 1);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, height, 0);
    }
  }

  private makeHill(): Slot {
    const group = new THREE.Group();
    const ringMaterial = glow(HILL_COLOUR, 0.85);
    const ring = new THREE.Mesh(this.ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    const beamMaterial = glow(HILL_COLOUR, 0.16);
    beamMaterial.side = THREE.DoubleSide;
    const beam = new THREE.Mesh(this.beamGeometry, beamMaterial);
    group.add(ring, beam);
    return { group, kind: 'hill', ring, beam, frame: [], materials: [ringMaterial, beamMaterial] };
  }

  private makeGoal(): Slot {
    const group = new THREE.Group();
    const ringMaterial = glow(0xffffff, 0.85);
    const ring = new THREE.Mesh(this.ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    // The frame is solid white paint, lit like the world, so it sits in the scene as an object.
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5 });
    const frame = [0, 1, 2].map(() => {
      const post = new THREE.Mesh(this.postGeometry, postMaterial);
      post.castShadow = true;
      return post;
    });
    group.add(ring, ...frame);
    return { group, kind: 'goal', ring, beam: null, frame, materials: [ringMaterial, postMaterial] };
  }

  private makePitch(): Slot {
    const group = new THREE.Group();
    // The pitch has no ring; the slot's ring is kept (hidden) so every slot has the same shape.
    const ringMaterial = glow(0xffffff, 0);
    const ring = new THREE.Mesh(this.ringGeometry, ringMaterial);
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5 });
    const materials: THREE.Material[] = [ringMaterial, postMaterial];
    const frame = [0, 1, 2, 3].map(() => {
      const post = new THREE.Mesh(this.postGeometry, postMaterial);
      post.castShadow = true;
      const flagMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      materials.push(flagMaterial);
      const flag = new THREE.Mesh(this.flagGeometry, flagMaterial);
      // Children of a post inherit its height scale, so undo it: the pennant hangs at the top.
      flag.scale.set(1, 1 / FLAG_HEIGHT, 1);
      flag.position.set(0, 0.5, 0);
      post.add(flag);
      return post;
    });
    group.add(ring, ...frame);
    return { group, kind: 'pitch', ring, beam: null, frame, materials };
  }

  private release(slot: Slot): void {
    slot.group.removeFromParent();
    for (const material of slot.materials) material.dispose();
  }

  /** How many markers are on screen — for tests. */
  get visibleCount(): number {
    return this.slots.filter((s) => s.group.visible).length;
  }

  dispose(): void {
    for (const slot of this.slots) this.release(slot);
    this.slots.length = 0;
    this.ringGeometry.dispose();
    this.beamGeometry.dispose();
    this.postGeometry.dispose();
    this.flagGeometry.dispose();
    this.group.removeFromParent();
  }
}

function glow(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
}
