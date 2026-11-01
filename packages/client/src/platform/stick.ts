/**
 * A thumbstick, shaped: a radial dead zone, rescaled so the output starts from zero at its edge,
 * then a response curve. Shared by the PC gamepad and the VR assisted-mode stick, so the rule is not
 * written twice.
 *
 * Both used to take each axis on its own (`|v| < dead ? 0 : v`), and that does three things nobody
 * would choose. It snaps the stick onto the axes: at full deflection, 20.8 % of the angles a stick
 * can be pushed at landed more than 1° off that heading on the gamepad, up to 10.3°, so a player
 * could not run at a heading within ten degrees of where the camera faced without turning it. It
 * makes the dead zone a square, 0.18 of travel along an axis and 0.255 along a diagonal. And with no
 * rescale the first speed past it is 18 % of full, jumped to from standing.
 *
 * `exponent` 1 is linear, which is right for movement. Look wants more of the stick for slow turns:
 * at 2, turns of 30°/s or less get 46 % of the live travel at the default sensitivity, where linear
 * with the old dead zone gave them 3.6 %, and the fastest turn is unchanged.
 */
export interface StickValue {
  x: number;
  y: number;
}

export function shapeStick(x: number, y: number, dead: number, exponent: number, out: StickValue): StickValue {
  const length = Number.isFinite(x) && Number.isFinite(y) ? Math.hypot(x, y) : 0;
  if (length <= dead) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  // A pad that reports its gate as a square reaches √2 in the corners; past the rim is the rim.
  const live = Math.min(1, (length - dead) / (1 - dead));
  const scale = live ** exponent / length;
  out.x = x * scale;
  out.y = y * scale;
  return out;
}
