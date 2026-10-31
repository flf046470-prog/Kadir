import * as THREE from 'three';
import type { Renderer } from '../render/Renderer.js';
import type { HudModel } from './hudModel.js';
import { wristLines } from './wristPanel.js';
import type { WristLine } from './wristPanel.js';

const CANVAS_W = 320;
const CANVAS_H = 360;
const LINE_H = 30;
const COLOURS: Record<WristLine['tone'], string> = {
  title: '#ffd166',
  normal: '#f2f7f0',
  dim: 'rgba(242,247,240,0.65)',
  warn: '#ff8a65',
  selected: '#9be37a',
};

/**
 * The match HUD for a headset: DOM has no meaning in an immersive session, so the same
 * `HudModel` the flat screen draws is shown on a small panel strapped to the left controller.
 */
export class VRWristHud {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D | null;
  private texture: THREE.CanvasTexture;
  private mesh: THREE.Mesh;
  private lastKey = '';

  constructor(renderer: Renderer) {
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.18),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true }),
    );
    // Lies on the back of the wrist, tilted up toward the player's eyes.
    this.mesh.position.set(0, 0.04, 0.06);
    this.mesh.rotation.x = -Math.PI / 2.4;
    this.mesh.visible = false;

    for (let i = 0; i < 2; i++) {
      const controller = renderer.renderer.xr.getController(i);
      controller.addEventListener('connected', (event) => {
        const handedness = (event as unknown as { data?: { handedness?: string } }).data?.handedness;
        if (handedness === 'left') controller.add(this.mesh);
      });
      controller.addEventListener('disconnected', () => {
        if (this.mesh.parent === controller) controller.remove(this.mesh);
      });
    }
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  /** Redraws only when the text changed: a canvas upload every XR frame is wasted bandwidth. */
  update(model: HudModel): void {
    const lines = wristLines(model);
    const key = lines.map((l) => `${l.tone}:${l.text}`).join('\n');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.draw(lines);
  }

  private draw(lines: WristLine[]): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = 'rgba(10, 22, 14, 0.85)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.textBaseline = 'top';
    lines.slice(0, Math.floor((CANVAS_H - 16) / LINE_H)).forEach((line, i) => {
      ctx.fillStyle = COLOURS[line.tone];
      ctx.font = `${line.tone === 'title' ? 'bold 24px' : '20px'} system-ui, sans-serif`;
      ctx.fillText(line.text, 12, 10 + i * LINE_H, CANVAS_W - 24);
    });
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }
}
