import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectDevice } from '../detect.js';
import { VRInput } from './VRInput.js';
import type { Renderer } from '../../render/Renderer.js';

/**
 * The VR entry path, which had never executed.
 *
 * There is no headset in CI and there never will be, so the first time any of this ran was going
 * to be the first time somebody put the game on a Quest — which is the one target this is being
 * built for. Rendering stereo genuinely needs a device; deciding to enter VR does not, and that is
 * where a wrong feature string, an unhandled rejection or a swallowed capability check lives.
 *
 * What is *not* covered, stated plainly so nobody reads a green suite as "VR works": three.js
 * actually presenting to an `XRSession`, the projection matrices, hand meshes, and anything about
 * comfort or frame rate in a real headset. Those need hardware.
 */

type XrStub = { isSessionSupported: (mode: string) => Promise<boolean>; requestSession: (...a: unknown[]) => Promise<unknown> };

function withNavigator(xr: XrStub | undefined, extra: Record<string, unknown> = {}): () => void {
  const host = globalThis as Record<string, unknown>;
  const savedNav = Object.getOwnPropertyDescriptor(host, 'navigator');
  const savedDoc = Object.getOwnPropertyDescriptor(host, 'document');
  Object.defineProperty(host, 'navigator', {
    value: { maxTouchPoints: 0, hardwareConcurrency: 8, xr, ...extra },
    configurable: true,
    writable: true,
  });
  // `detectDevice` reads `'pointerLockElement' in document` to tell a desktop from a tablet, and
  // the test environment is plain Node.
  Object.defineProperty(host, 'document', {
    value: { pointerLockElement: null },
    configurable: true,
    writable: true,
  });
  return () => {
    if (savedNav) Object.defineProperty(host, 'navigator', savedNav);
    else delete host.navigator;
    if (savedDoc) Object.defineProperty(host, 'document', savedDoc);
    else delete host.document;
  };
}

/** Only as much of `Renderer` as entering and leaving a session touches. */
function fakeRenderer(): { renderer: Renderer; setSession: ReturnType<typeof vi.fn> } {
  const setSession = vi.fn(async () => undefined);
  const object3d = () => ({ addEventListener: () => {}, add: () => {}, position: { set: () => {} } });
  const renderer = {
    renderer: {
      xr: {
        setSession,
        isPresenting: false,
        getController: object3d,
        getControllerGrip: object3d,
        getHand: object3d,
        getCamera: () => ({ getWorldPosition: () => {}, quaternion: {} }),
      },
    },
    rig: { add: () => {}, position: { y: 0 } },
  } as unknown as Renderer;
  return { renderer, setSession };
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

describe('deciding the device is a headset', () => {
  it('reports VR when the runtime supports an immersive session', async () => {
    restore = withNavigator({
      isSessionSupported: async (mode) => mode === 'immersive-vr',
      requestSession: async () => ({}),
    });
    const caps = await detectDevice();
    expect(caps.hasXr).toBe(true);
    expect(caps.kind).toBe('vr');
  });

  it('does not claim VR when the runtime says no', async () => {
    restore = withNavigator({ isSessionSupported: async () => false, requestSession: async () => ({}) });
    const caps = await detectDevice();
    expect(caps.hasXr).toBe(false);
    expect(caps.kind).not.toBe('vr');
  });

  it('survives a runtime that throws instead of answering', async () => {
    /**
     * Not hypothetical: `isSessionSupported` rejects on a page served over plain HTTP, and in an
     * iframe without `xr-spatial-tracking`. An unhandled rejection here happens during boot, so it
     * does not degrade to flat play — it takes the whole client down before anything renders.
     */
    restore = withNavigator({
      isSessionSupported: async () => {
        throw new DOMException('permissions policy', 'SecurityError');
      },
      requestSession: async () => ({}),
    });
    const caps = await detectDevice();
    expect(caps.hasXr).toBe(false);
  });

  it('survives a browser with no WebXR at all', async () => {
    restore = withNavigator(undefined);
    await expect(detectDevice()).resolves.toMatchObject({ hasXr: false });
  });
});

describe('entering VR', () => {
  it('asks for the features the game actually uses', async () => {
    /**
     * `local-floor` is what puts the player on the ground, `hand-tracking` is what makes a
     * controller-free grab possible, and both are *optional* on purpose: a runtime that lacks one
     * must still give a session rather than refusing outright. A typo in any of these strings is
     * invisible until a headset refuses, which is the day of the store submission.
     */
    const requestSession = vi.fn(async () => ({ end: async () => {} }));
    restore = withNavigator({ isSessionSupported: async () => true, requestSession });
    const { renderer, setSession } = fakeRenderer();

    await expect(new VRInput(renderer).enterVr()).resolves.toBe(true);

    expect(requestSession).toHaveBeenCalledOnce();
    const [mode, options] = requestSession.mock.calls[0] as unknown as [string, { optionalFeatures: string[] }];
    expect(mode).toBe('immersive-vr');
    expect(options.optionalFeatures).toContain('local-floor');
    expect(options.optionalFeatures).toContain('hand-tracking');
    expect(setSession).toHaveBeenCalledOnce();
  });

  it('reports failure rather than throwing when the request is refused', async () => {
    // The ordinary case, not an edge one: a player who dismisses the headset permission prompt, or
    // a browser that will not grant a session from that gesture. It has to land back in the menu.
    restore = withNavigator({
      isSessionSupported: async () => true,
      requestSession: async () => {
        throw new DOMException('refused', 'NotAllowedError');
      },
    });
    const { renderer, setSession } = fakeRenderer();
    await expect(new VRInput(renderer).enterVr()).resolves.toBe(false);
    expect(setSession).not.toHaveBeenCalled();
  });

  it('reports failure when the browser has no WebXR', async () => {
    restore = withNavigator(undefined);
    const { renderer } = fakeRenderer();
    await expect(new VRInput(renderer).enterVr()).resolves.toBe(false);
  });

  it('ends the session on the way out, and tolerates never having had one', async () => {
    const end = vi.fn(async () => undefined);
    restore = withNavigator({ isSessionSupported: async () => true, requestSession: async () => ({ end }) });
    const { renderer } = fakeRenderer();
    const input = new VRInput(renderer);

    // Leaving without entering must not throw: the menu offers "Exit VR" from a state the player
    // can reach by having the headset end the session itself.
    await expect(input.exitVr()).resolves.toBeUndefined();

    await input.enterVr();
    await input.exitVr();
    expect(end).toHaveBeenCalledOnce();
  });
});
