import * as THREE from 'three';
import type { AnimalDef, CosmeticDef, PlayerSnapshot } from '@kc/core';
import { SnapFlags, getAnimal, getCosmetic } from '@kc/core';

/**
 * Procedural animal avatars.
 *
 * Bodies are built from primitives driven by `AnimalDef.visual`, so a new animal is a data
 * entry — no mesh pipeline, no download, and every animal automatically has the same hitbox.
 * Cosmetics attach to named sockets (head, face, back, tail, hands).
 */
export class Avatar {
  readonly group = new THREE.Group();
  readonly head = new THREE.Group();
  readonly body = new THREE.Group();
  readonly hands: [THREE.Group, THREE.Group];

  private animal: AnimalDef;
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private sockets: Record<string, THREE.Group> = {};
  private cosmeticNodes = new Map<string, THREE.Object3D>();
  private tail: THREE.Mesh | null = null;
  private nameSprite: THREE.Sprite | null = null;
  private roleRing: THREE.Mesh | null = null;
  private hopPhase = 0;

  constructor(animalId: string, castShadow: boolean) {
    this.animal = getAnimal(animalId) ?? (getAnimal('kangaroo') as AnimalDef);
    this.hands = [new THREE.Group(), new THREE.Group()];
    this.build(castShadow);
  }

  get animalId(): string {
    return this.animal.id;
  }

  private mat(color: number, options: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
    const material = new THREE.MeshLambertMaterial({ color, flatShading: true, ...options });
    this.materials.push(material);
    return material;
  }

  private geo<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private build(castShadow: boolean): void {
    const visual = this.animal.visual;
    const bodyMat = this.mat(visual.body);
    const accentMat = this.mat(visual.accent);
    const bellyMat = this.mat(visual.belly);

    // Torso — a squashed capsule that reads as an animal from any angle.
    const torso = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.3, 0.42, 4, 8)), bodyMat);
    torso.position.y = 0.62;
    torso.castShadow = castShadow;
    this.body.add(torso);

    const belly = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.24, 8, 6)), bellyMat);
    belly.position.set(0, 0.55, 0.14);
    belly.scale.set(1, 1.25, 0.7);
    this.body.add(belly);

    // Legs.
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.12, 0.26, 3, 6)), bodyMat);
      leg.position.set(side * 0.16, 0.22, 0.02);
      leg.castShadow = castShadow;
      this.body.add(leg);
      const foot = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.16, 0.09, 0.36)), accentMat);
      foot.position.set(side * 0.16, 0.05, 0.12);
      this.body.add(foot);
    }

    // Head + face.
    const skull = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.22, 10, 8)), bodyMat);
    skull.castShadow = castShadow;
    this.head.add(skull);

    const snout = this.buildSnout(visual.snout, bodyMat, bellyMat);
    if (snout) this.head.add(snout);
    for (const ear of this.buildEars(visual.ears, bodyMat, accentMat)) this.head.add(ear);

    const eyeGeo = this.geo(new THREE.SphereGeometry(0.045, 6, 5));
    const eyeMat = this.mat(0x14181c);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(side * 0.09, 0.05, 0.19);
      this.head.add(eye);
    }

    this.head.position.y = 1.08;
    this.body.add(this.head);

    // Tail — the kangaroo's balance organ, and a great silhouette cue at distance.
    this.tail = this.buildTail(visual.tail, bodyMat);
    if (this.tail) this.body.add(this.tail);

    // Hands: visible for everyone, but only VR players drive them from real tracking.
    const handGeo = this.geo(new THREE.SphereGeometry(0.09, 7, 6));
    for (const hand of this.hands) {
      const mesh = new THREE.Mesh(handGeo, accentMat);
      mesh.castShadow = castShadow;
      hand.add(mesh);
      this.group.add(hand);
    }

    this.sockets.head = new THREE.Group();
    this.sockets.head.position.y = 0.2;
    this.head.add(this.sockets.head);

    this.sockets.face = new THREE.Group();
    this.sockets.face.position.set(0, 0.03, 0.2);
    this.head.add(this.sockets.face);

    this.sockets.back = new THREE.Group();
    this.sockets.back.position.set(0, 0.68, -0.22);
    this.body.add(this.sockets.back);

    this.sockets.tail = new THREE.Group();
    this.sockets.tail.position.set(0, 0.4, -0.5);
    this.body.add(this.sockets.tail);

    this.group.add(this.body);

    const ringGeo = this.geo(new THREE.RingGeometry(0.42, 0.56, 18));
    const ringMat = this.mat(0xffffff, { transparent: true, opacity: 0.0, side: THREE.DoubleSide });
    this.roleRing = new THREE.Mesh(ringGeo, ringMat);
    this.roleRing.rotation.x = -Math.PI / 2;
    this.roleRing.position.y = 0.03;
    this.group.add(this.roleRing);
  }

  private buildEars(kind: string, bodyMat: THREE.Material, accentMat: THREE.Material): THREE.Mesh[] {
    if (kind === 'none') return [];
    const out: THREE.Mesh[] = [];
    const geometry =
      kind === 'tall'
        ? this.geo(new THREE.CapsuleGeometry(0.05, 0.24, 3, 5))
        : kind === 'pointed'
          ? this.geo(new THREE.ConeGeometry(0.09, 0.22, 4))
          : kind === 'fin'
            ? this.geo(new THREE.ConeGeometry(0.1, 0.3, 3))
            : this.geo(new THREE.SphereGeometry(0.1, 6, 5));
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(geometry, side < 0 ? bodyMat : accentMat);
      ear.position.set(side * 0.12, 0.24, kind === 'fin' ? -0.05 : 0);
      ear.rotation.z = side * 0.22;
      out.push(ear);
    }
    return out;
  }

  private buildSnout(kind: string, bodyMat: THREE.Material, bellyMat: THREE.Material): THREE.Mesh | null {
    switch (kind) {
      case 'long': {
        const snout = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.08, 0.16, 3, 6)), bodyMat);
        snout.position.set(0, -0.02, 0.22);
        snout.rotation.x = Math.PI / 2;
        return snout;
      }
      case 'beak': {
        const beak = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.08, 0.2, 4)), bellyMat);
        beak.position.set(0, -0.01, 0.24);
        beak.rotation.x = Math.PI / 2;
        return beak;
      }
      case 'flat': {
        const flat = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.22, 0.08, 0.14)), bodyMat);
        flat.position.set(0, -0.04, 0.2);
        return flat;
      }
      default: {
        const short = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.1, 7, 6)), bodyMat);
        short.position.set(0, -0.02, 0.19);
        short.scale.set(1, 0.8, 1.1);
        return short;
      }
    }
  }

  private buildTail(kind: string, bodyMat: THREE.Material): THREE.Mesh | null {
    if (kind === 'stub') {
      const stub = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.12, 6, 5)), bodyMat);
      stub.position.set(0, 0.42, -0.3);
      return stub;
    }
    const geometry =
      kind === 'thick'
        ? this.geo(new THREE.CapsuleGeometry(0.11, 0.62, 4, 7))
        : kind === 'bushy'
          ? this.geo(new THREE.CapsuleGeometry(0.14, 0.5, 4, 7))
          : kind === 'fin'
            ? this.geo(new THREE.ConeGeometry(0.16, 0.6, 3))
            : this.geo(new THREE.CapsuleGeometry(0.06, 0.55, 3, 6));
    const tail = new THREE.Mesh(geometry, bodyMat);
    tail.position.set(0, 0.4, -0.42);
    tail.rotation.x = kind === 'fin' ? 0 : -0.9;
    return tail;
  }

  /** Equip cosmetics by slot. Unknown or unowned ids are simply ignored. */
  setCosmetics(cosmetics: Record<string, string>): void {
    for (const [, node] of this.cosmeticNodes) node.removeFromParent();
    this.cosmeticNodes.clear();

    for (const [slot, id] of Object.entries(cosmetics)) {
      const def = getCosmetic(id);
      if (!def) continue;
      const node = this.buildCosmetic(def);
      if (!node) continue;
      const socket = socketForSlot(slot);
      const parent = this.sockets[socket];
      if (!parent) continue;
      parent.add(node);
      this.cosmeticNodes.set(slot, node);
    }
  }

  private buildCosmetic(def: CosmeticDef): THREE.Object3D | null {
    const material = this.mat(def.visual.color);
    switch (def.slot) {
      case 'hat': {
        const geometry =
          def.visual.shape === 'crown'
            ? this.geo(new THREE.CylinderGeometry(0.17, 0.19, 0.14, 7, 1, true))
            : def.visual.shape === 'brim'
              ? this.geo(new THREE.CylinderGeometry(0.13, 0.26, 0.16, 10))
              : this.geo(new THREE.ConeGeometry(0.18, 0.2, 5));
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = 0.08;
        return mesh;
      }
      case 'mask':
        return new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.26, 0.16, 0.06)), material);
      case 'glasses': {
        const group = new THREE.Group();
        const lens = this.geo(new THREE.CircleGeometry(0.07, 8));
        for (const side of [-1, 1]) {
          const mesh = new THREE.Mesh(lens, material);
          mesh.position.set(side * 0.09, 0.04, 0.02);
          group.add(mesh);
        }
        return group;
      }
      case 'backpack':
        return new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.28, 0.32, 0.18)), material);
      case 'tail':
        return new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.1, 0.4, 3, 6)), material);
      case 'hands': {
        const group = new THREE.Group();
        // Hand cosmetics attach to the hands themselves rather than a body socket.
        const geometry = this.geo(new THREE.SphereGeometry(0.11, 7, 6));
        for (const hand of this.hands) {
          const mesh = new THREE.Mesh(geometry, material);
          hand.add(mesh);
          group.add(new THREE.Object3D());
        }
        return group;
      }
      case 'effect':
      case 'trail': {
        const mesh = new THREE.Mesh(
          this.geo(new THREE.TorusGeometry(0.5, 0.03, 4, 14)),
          this.mat(def.visual.color, { transparent: true, opacity: 0.55 }),
        );
        mesh.rotation.x = Math.PI / 2;
        return mesh;
      }
      default:
        return null;
    }
  }

  /** Nameplate above the head. Pass `show = false` for the local player — you know who you are,
   * and at third-person distance your own plate covers the middle of the screen. */
  setName(name: string, color = '#f2f7f0', show = true): void {
    if (!show) {
      this.nameSprite?.removeFromParent();
      this.nameSprite = null;
      return;
    }
    this.nameSprite?.removeFromParent();
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeText(name, 128, 32);
    ctx.fillStyle = color;
    ctx.fillText(name, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    this.materials.push(material);
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.1, 0.28, 1);
    sprite.position.y = 1.65;
    sprite.renderOrder = 10;
    this.group.add(sprite);
    this.nameSprite = sprite;
  }

  /** Role colour ring on the ground — how you spot the chaser across a canyon. */
  setRole(role: string): void {
    if (!this.roleRing) return;
    const material = this.roleRing.material as THREE.MeshLambertMaterial;
    switch (role) {
      case 'chaser':
      case 'infected':
        material.color.setHex(0xff4d4d);
        material.opacity = 0.85;
        break;
      case 'runner':
        material.color.setHex(0x4cc9f0);
        material.opacity = 0.35;
        break;
      case 'fighter':
        material.color.setHex(0xffd166);
        material.opacity = 0.5;
        break;
      default:
        material.opacity = 0;
    }
  }

  /**
   * Drive the avatar from a snapshot. Hops are animated procedurally from vertical velocity, so
   * remote players read correctly without shipping animation clips.
   */
  update(snapshot: PlayerSnapshot, dt: number, cameraPosition: THREE.Vector3): void {
    this.group.position.set(snapshot.x, snapshot.y, snapshot.z);
    this.body.rotation.y = snapshot.yaw;

    const grounded = (snapshot.flags & SnapFlags.Grounded) !== 0;
    const crouching = (snapshot.flags & SnapFlags.Crouching) !== 0;
    const speed = Math.hypot(snapshot.vx, snapshot.vz);

    // Squash on landing, stretch in the air: the classic readability trick.
    const stretch = grounded ? 1 - Math.min(0.25, speed * 0.012) : 1 + Math.min(0.3, Math.abs(snapshot.vy) * 0.02);
    const squash = crouching ? 0.65 : 1 / stretch;
    this.body.scale.set(squash, stretch * (crouching ? 0.7 : 1), squash);

    if (grounded && speed > 0.5) {
      this.hopPhase += dt * (4 + speed * 0.8);
      this.body.position.y = Math.abs(Math.sin(this.hopPhase)) * 0.12;
      this.body.rotation.x = Math.sin(this.hopPhase) * 0.06;
    } else {
      this.hopPhase = 0;
      this.body.position.y += (0 - this.body.position.y) * Math.min(1, dt * 10);
      this.body.rotation.x += (0 - this.body.rotation.x) * Math.min(1, dt * 10);
    }

    if (this.tail) {
      this.tail.rotation.z = Math.sin(this.hopPhase * 0.9) * 0.16;
      this.tail.rotation.x = -0.9 + (grounded ? 0 : -0.35);
    }

    this.head.rotation.x = -snapshot.pitch * 0.5;

    const hands = snapshot.hands;
    for (let i = 0; i < 2; i++) {
      const hand = this.hands[i] as THREE.Group;
      if (hands) {
        const target = hands[i];
        if (target) hand.position.set(target.x, target.y, target.z);
        hand.visible = true;
      } else {
        // Non-VR players get procedural arms so the avatar never looks broken.
        const side = i === 0 ? -1 : 1;
        const swing = grounded ? Math.sin(this.hopPhase + (i === 0 ? 0 : Math.PI)) * 0.12 : 0.25;
        const forward = 0.22 + swing;
        hand.position.set(
          Math.cos(snapshot.yaw) * side * 0.28 + Math.sin(snapshot.yaw) * forward,
          0.72 + swing * 0.4,
          -Math.sin(snapshot.yaw) * side * 0.28 + Math.cos(snapshot.yaw) * forward,
        );
        hand.visible = true;
      }
    }

    if (this.nameSprite) {
      const distance = this.group.position.distanceTo(cameraPosition);
      this.nameSprite.visible = distance < 42;
      const scale = Math.max(1, distance * 0.045);
      this.nameSprite.scale.set(1.1 * scale, 0.28 * scale, 1);
    }
  }

  setDetailed(detailed: boolean): void {
    // Distant avatars drop their hands and nameplate; the body silhouette is what matters.
    for (const hand of this.hands) hand.visible = detailed;
    if (this.nameSprite) this.nameSprite.visible = detailed;
  }

  dispose(): void {
    for (const material of this.materials) material.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}

function socketForSlot(slot: string): string {
  switch (slot) {
    case 'hat':
      return 'head';
    case 'mask':
    case 'glasses':
      return 'face';
    case 'backpack':
      return 'back';
    case 'tail':
      return 'tail';
    default:
      return 'back';
  }
}
