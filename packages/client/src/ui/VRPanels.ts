import * as THREE from 'three';
import type { Renderer } from '../render/Renderer.js';

export interface VrButton {
  id: string;
  label: string;
  /** Optional right-aligned value, e.g. a price or the current setting. */
  value?: string;
  disabled?: boolean;
}

export interface VrMenuOptions {
  renderer: Renderer;
  onSelect(id: string): void;
}

const WIDTH = 1.05;
const HEIGHT = 1.35;
const CANVAS_W = 512;
const CANVAS_H = 660;
const BUTTON_H = 68;
const BUTTON_TOP = 132;
/** Below this a row is too small to hit reliably with a controller ray at arm's length. */
const MIN_BUTTON_H = 42;
const MAX_BUTTONS = Math.floor((CANVAS_H - BUTTON_TOP - 16) / MIN_BUTTON_H);

/**
 * World-space VR menu.
 *
 * DOM has no meaning inside an immersive session, so the VR UI is a textured quad the player
 * points at with a controller — the interaction model every headset user already knows. The menu
 * is parented to the rig, so it follows the player without ever being *attached to their face*.
 */
export class VRMenu {
  readonly group = new THREE.Group();
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private texture: THREE.CanvasTexture;
  private mesh: THREE.Mesh;
  private pointers: THREE.Line[] = [];
  private controllers: THREE.Group[] = [];
  private raycaster = new THREE.Raycaster();
  private buttons: VrButton[] = [];
  private title = '';
  private subtitle = '';
  private hovered = -1;
  /** Rows shrink to fit a long list — a tuning page needs more entries than a main menu. */
  private rowHeight = BUTTON_H;
  private options: VrMenuOptions;
  private visible = false;

  constructor(options: VrMenuOptions) {
    this.options = options;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(WIDTH, HEIGHT),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true }),
    );
    this.mesh.position.set(0, 1.35, -1.25);
    this.group.add(this.mesh);
    this.group.visible = false;
    options.renderer.rig.add(this.group);

    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -3)]);
    for (let i = 0; i < 2; i++) {
      const controller = options.renderer.renderer.xr.getController(i);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.7 }));
      line.visible = false;
      controller.add(line);
      controller.addEventListener('selectstart', () => this.click());
      this.controllers.push(controller);
      this.pointers.push(line);
    }
  }

  setContent(title: string, subtitle: string, buttons: VrButton[]): void {
    this.title = title;
    this.subtitle = subtitle;
    this.buttons = buttons.slice(0, MAX_BUTTONS);
    const available = CANVAS_H - BUTTON_TOP - 16;
    this.rowHeight = Math.min(BUTTON_H, Math.max(MIN_BUTTON_H, Math.floor(available / Math.max(1, this.buttons.length))));
    this.draw();
  }

  show(): void {
    this.visible = true;
    this.group.visible = true;
    for (const pointer of this.pointers) pointer.visible = true;
  }

  hide(): void {
    this.visible = false;
    this.group.visible = false;
    for (const pointer of this.pointers) pointer.visible = false;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Called every XR frame: updates hover from whichever controller is pointing at the panel. */
  update(): void {
    if (!this.visible) return;
    let hovered = -1;
    for (const controller of this.controllers) {
      this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      this.raycaster.ray.direction.set(0, 0, -1).transformDirection(controller.matrixWorld);
      const hit = this.raycaster.intersectObject(this.mesh, false)[0];
      if (!hit?.uv) continue;
      const y = (1 - hit.uv.y) * CANVAS_H;
      const index = Math.floor((y - BUTTON_TOP) / this.rowHeight);
      if (index >= 0 && index < this.buttons.length) hovered = index;
    }
    if (hovered !== this.hovered) {
      this.hovered = hovered;
      this.draw();
    }
  }

  private click(): void {
    if (!this.visible || this.hovered < 0) return;
    const button = this.buttons[this.hovered];
    if (!button || button.disabled) return;
    this.options.onSelect(button.id);
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = 'rgba(10, 22, 14, 0.94)';
    roundRect(ctx, 0, 0, CANVAS_W, CANVAS_H, 24);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.stroke();

    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(this.title, 32, 34);

    ctx.fillStyle = 'rgba(242,247,240,0.7)';
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText(this.subtitle, 32, 88);

    this.buttons.forEach((button, index) => {
      const y = BUTTON_TOP + index * this.rowHeight;
      const active = index === this.hovered && !button.disabled;
      ctx.fillStyle = button.disabled
        ? 'rgba(255,255,255,0.06)'
        : active
          ? 'rgba(76,175,80,0.85)'
          : 'rgba(255,255,255,0.12)';
      roundRect(ctx, 24, y, CANVAS_W - 48, this.rowHeight - 8, 14);
      ctx.fill();

      ctx.fillStyle = button.disabled ? 'rgba(242,247,240,0.45)' : '#f2f7f0';
      const fontSize = this.rowHeight >= 60 ? 26 : 21;
      const textY = y + Math.round((this.rowHeight - 8 - fontSize) / 2);
      ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
      ctx.fillText(button.label, 48, textY);

      if (button.value) {
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(242,247,240,0.75)';
        ctx.fillText(button.value, CANVAS_W - 48, textY);
        ctx.textAlign = 'left';
      }
    });

    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
    this.group.removeFromParent();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
