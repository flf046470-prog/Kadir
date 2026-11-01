/**
 * How often the world is drawn while a menu covers it.
 *
 * Every menu screen is a `.kc-screen`, whose background is 86–95 % opaque, so behind a menu the
 * world is a faint tint through it. It was still drawn every frame at full cost: measured in
 * swiftshader on the jungle, two seconds a frame on the main menu, the same as in play. A phone
 * sitting on the menu spent its battery on pixels nobody could make out, and a Playwright click,
 * which waits on about ten of the page's frames, took 22 s of a 30 s limit there and timed out in
 * CI once a spawn facing turned the backdrop towards the busier middle of the map.
 *
 * The simulation, the camera and the sound keep running every frame; only the draw is skipped. A
 * headset is never thinned: an XR frame that is not drawn is a frame the compositor reprojects,
 * and the menu there is a panel in the world rather than a screen over it.
 */
export const BACKDROP_EVERY = 4;

/**
 * Whether this frame draws. `coveredFrames` counts frames since the menu went up, from 0, so the
 * first frame under a new menu is drawn and the world is never left showing a stale picture.
 */
export function drawsFrame(coveredFrames: number, covered: boolean, presenting: boolean): boolean {
  if (!covered || presenting) return true;
  return coveredFrames % BACKDROP_EVERY === 0;
}
