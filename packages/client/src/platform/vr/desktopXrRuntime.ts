import { DesktopXr, SIM_HANDS, simControls } from './desktopXr.js';
import type { SimState } from './desktopXr.js';

/**
 * The desktop VR simulator: IWER (Meta's Immersive Web Emulation Runtime, MIT) installed as
 * `navigator.xr`, driven by `DesktopXr` from the keyboard and mouse. Opened with `?xrsim`.
 *
 * It replaces the browser's WebXR before the game probes it, so `detectDevice` finds an
 * `immersive-vr` device and the whole VR path runs unchanged — `VRInput`, the VR menu, "Enter VR",
 * arms-first locomotion, the comfort code. That is the point of emulating the device rather than
 * faking the game's input: what is tested is the code a headset runs.
 *
 * Three rules keep it from reaching anyone who did not ask for it:
 * - **Opt-in per tab.** Only `?xrsim` installs it; nothing is stored, so a reload without it is
 *   the normal game.
 * - **Never over a real headset.** If the browser's own WebXR can already present `immersive-vr`,
 *   the simulator stays off and says why: shadowing a real device would leave a player in a
 *   headset looking at an emulated one. (Meta's Immersive Web Emulator extension is IWER too, and
 *   reads the same way; with it installed, the extension's own panel is the simulator.)
 * - **Off the boot path.** IWER is a dynamic import in its own `xrsim` chunk, which the precache
 *   excludes by name like the crash reporter, so a page without `?xrsim` never downloads it.
 */

export type DesktopXrStart =
  | { active: true; sim: DesktopXr }
  | { active: false; reason: 'native-headset' | 'failed'; message: string };

/** `?xrsim` or `?xrsim=1` asks for the simulator; `?xrsim=0` and its absence do not. */
export function wantsDesktopXr(search: string): boolean {
  const value = new URLSearchParams(search).get('xrsim');
  return value !== null && value !== '0' && value !== 'false';
}

/** The same page without `?xrsim`: the way back to the game as it normally runs. */
export function withoutDesktopXr(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('xrsim');
  return url.toString();
}

interface IwerController {
  position: { set(x: number, y: number, z: number): unknown };
  quaternion: { set(x: number, y: number, z: number, w: number): unknown };
  gamepadConfig: { buttons: ({ id: string } | null)[] };
  updateButtonValue(id: string, value: number): void;
  updateAxes(id: string, x: number, y: number): void;
}

interface IwerDevice {
  position: { set(x: number, y: number, z: number): unknown };
  quaternion: { set(x: number, y: number, z: number, w: number): unknown };
  controllers: Partial<Record<'left' | 'right', IwerController>>;
  activeSession: { end(): Promise<void> } | undefined;
  installRuntime(options?: { forceInstall?: boolean }): void;
}

/**
 * Install the simulator, before the game looks at `navigator.xr`. Never throws: a simulator that
 * cannot start leaves the browser's WebXR as it was and the game boots as it would have.
 */
export async function startDesktopXr(): Promise<DesktopXrStart> {
  const native = navigator.xr;
  if (native) {
    try {
      if (await native.isSessionSupported('immersive-vr')) {
        return {
          active: false,
          reason: 'native-headset',
          // A headset, or an emulator extension such as Meta's Immersive Web Emulator, which
          // replaces `navigator.xr` before the page runs. Either way the browser can present
          // already, and a second emulator on top of it would only be in the way.
          message: 'This browser can already enter VR (a headset, or an emulator extension), so the desktop simulator stayed off.',
        };
      }
    } catch {
      // A browser that cannot answer cannot present either.
    }
  }
  try {
    const { XRDevice, metaQuest3 } = await import('iwer');
    // Mono: one view filling the window is what a desktop tester wants to look at. Stereo is the
    // same session with two viewports, and nothing in the game depends on which.
    const device = new XRDevice(metaQuest3, { stereoEnabled: false }) as unknown as IwerDevice;
    // A desktop Chrome has a `navigator.xr` that cannot present, and IWER declines to replace a
    // native one unless forced. It was just asked whether it can present, and it cannot.
    device.installRuntime({ forceInstall: true });
    const sim = new DesktopXr();
    drive(device, sim);
    // For `check:xrsim`, under automation only: what the simulator last handed the device.
    if (navigator.webdriver) (window as unknown as { __kcXrSim?: DesktopXr }).__kcXrSim = sim;
    return { active: true, sim };
  } catch (error) {
    return { active: false, reason: 'failed', message: `The desktop VR simulator could not start: ${(error as Error).message}` };
  }
}

/** Feed the browser's input to `sim` while a session is running, and its state to the device. */
function drive(device: IwerDevice, sim: DesktopXr): void {
  const presenting = () => device.activeSession !== undefined;
  const overlay = new SimOverlay(device);

  // Keys are taken only while presenting: before "Enter VR" the page is the ordinary menu and
  // must type names and press buttons as it always does.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!presenting() || isTextInput(event.target)) return;
      if (event.code === 'KeyH') {
        overlay.toggleHelp();
        event.preventDefault();
        return;
      }
      if (sim.keyDown(event.code)) event.preventDefault();
    },
    true,
  );
  window.addEventListener('keyup', (event) => {
    if (sim.keyUp(event.code)) event.preventDefault();
  });
  window.addEventListener('blur', () => sim.releaseAll());

  window.addEventListener(
    'mousedown',
    (event) => {
      if (!presenting() || overlay.contains(event.target)) return;
      const canvas = event.target instanceof HTMLCanvasElement ? event.target : null;
      // A click into the view captures the mouse, and it is still the right trigger: the VR menu
      // is pointed at with the head and selected with the trigger, so aiming with the mouse and
      // clicking is how a desktop tester presses a panel button.
      if (canvas && document.pointerLockElement !== canvas && canvas.requestPointerLock) {
        try {
          void Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
        } catch {
          // Without pointer lock, plain mouse movement still looks (below).
        }
      }
      if (sim.mouseButton(event.button, true)) event.preventDefault();
    },
    true,
  );
  window.addEventListener('mouseup', (event) => {
    if (sim.mouseButton(event.button, false)) event.preventDefault();
  });
  window.addEventListener('contextmenu', (event) => {
    if (presenting()) event.preventDefault();
  });
  window.addEventListener('mousemove', (event) => {
    if (!presenting()) return;
    sim.mouseMove(event.movementX, event.movementY);
  });
  window.addEventListener(
    'wheel',
    (event) => {
      if (presenting() && sim.wheel(event.deltaY)) event.preventDefault();
    },
    { passive: false },
  );

  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    apply(device, sim.step(dt));
    overlay.update(presenting());
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function apply(device: IwerDevice, state: SimState): void {
  const { head } = state;
  device.position.set(...head.position);
  device.quaternion.set(...head.quaternion);
  for (const hand of SIM_HANDS) {
    const controller = device.controllers[hand];
    if (!controller) continue;
    const pose = state.controllers[hand];
    controller.position.set(...pose.position);
    controller.quaternion.set(...pose.quaternion);
    // By index, through the controller's own layout, so the button a key presses is the one
    // `VR_BINDINGS` reads by that index whatever the profile calls it.
    controller.gamepadConfig.buttons.forEach((button, index) => {
      if (button) controller.updateButtonValue(button.id, pose.buttons[index] ?? 0);
    });
    controller.updateAxes('thumbstick', pose.stick[0], pose.stick[1]);
  }
}

/** The controls, and the two ways out: of VR, and of the simulator. */
class SimOverlay {
  private readonly root: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly exitButton: HTMLButtonElement;
  private wasPresenting: boolean | null = null;

  constructor(device: IwerDevice) {
    this.root = document.createElement('div');
    this.root.id = 'kc-xrsim';
    // Above IWER's own container (z-index 999), which holds the canvas while a session runs.
    Object.assign(this.root.style, {
      position: 'fixed',
      left: '12px',
      bottom: '12px',
      zIndex: '10000',
      maxWidth: '420px',
      padding: '10px 12px',
      borderRadius: '10px',
      background: 'rgba(10, 22, 14, 0.82)',
      color: '#eef6ee',
      font: '12px/1.45 system-ui, sans-serif',
      pointerEvents: 'auto',
    } satisfies Partial<CSSStyleDeclaration>);

    const title = document.createElement('div');
    title.textContent = 'Desktop VR simulator';
    title.style.fontWeight = '700';
    this.status = document.createElement('div');
    this.status.style.opacity = '0.85';

    this.help = document.createElement('div');
    this.help.style.marginTop = '6px';
    for (const line of simControls()) {
      const row = document.createElement('div');
      const keys = document.createElement('b');
      keys.textContent = line.keys;
      row.append(keys, ` — ${line.does}`);
      this.help.append(row);
    }

    const buttons = document.createElement('div');
    buttons.style.marginTop = '8px';
    buttons.style.display = 'flex';
    buttons.style.gap = '8px';
    this.exitButton = makeButton('Exit VR', () => void device.activeSession?.end());
    const leave = makeButton('Leave simulator', () => location.assign(withoutDesktopXr(location.href)));
    buttons.append(this.exitButton, leave);

    this.root.append(title, this.status, this.help, buttons);
    document.body.append(this.root);
  }

  update(presenting: boolean): void {
    if (presenting === this.wasPresenting) return;
    this.wasPresenting = presenting;
    this.status.textContent = presenting
      ? 'In VR. Click the view to capture the mouse. H hides this.'
      : 'No headset needed: press Enter VR to start an emulated Meta Quest 3 session.';
    this.exitButton.style.display = presenting ? '' : 'none';
    // Out of VR the page's own menu is what matters; the key list is for once there is a world.
    this.help.style.display = presenting ? '' : 'none';
  }

  toggleHelp(): void {
    this.help.style.display = this.help.style.display === 'none' ? '' : 'none';
  }

  contains(target: EventTarget | null): boolean {
    return target instanceof Node && this.root.contains(target);
  }
}

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  Object.assign(button.style, {
    font: 'inherit',
    padding: '4px 10px',
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.3)',
    background: 'rgba(46,110,52,0.9)',
    color: 'inherit',
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

/** A notice for when the simulator was asked for and stayed off, so it is not silently missing. */
export function showDesktopXrNotice(message: string): void {
  const note = document.createElement('div');
  note.id = 'kc-xrsim-notice';
  note.textContent = message;
  Object.assign(note.style, {
    position: 'fixed',
    left: '12px',
    bottom: '12px',
    zIndex: '10000',
    maxWidth: '420px',
    padding: '8px 12px',
    borderRadius: '10px',
    background: 'rgba(60, 30, 10, 0.88)',
    color: '#fff3e6',
    font: '12px/1.45 system-ui, sans-serif',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.append(note);
  setTimeout(() => note.remove(), 12000);
}

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}
