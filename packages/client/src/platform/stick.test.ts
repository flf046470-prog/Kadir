import { describe, expect, it } from 'vitest';

import { shapeStick } from './stick.js';

const shaped = (x: number, y: number, dead = 0.18, exponent = 1) => shapeStick(x, y, dead, exponent, { x: 0, y: 0 });
const rad = (degrees: number) => (degrees * Math.PI) / 180;

describe('shapeStick', () => {
  it('goes where it is pushed, at every angle', () => {
    // Per axis, every angle within 10.3° of an axis came out on the axis.
    for (let degrees = 0; degrees < 360; degrees += 0.5) {
      for (const push of [0.3, 0.6, 1]) {
        const { x, y } = shaped(push * Math.sin(rad(degrees)), push * Math.cos(rad(degrees)));
        let error = Math.abs(Math.atan2(x, y) - Math.atan2(Math.sin(rad(degrees)), Math.cos(rad(degrees))));
        if (error > Math.PI) error = 2 * Math.PI - error;
        expect(error, `${degrees}° at ${push}`).toBeLessThan(1e-9);
      }
    }
  });

  it('has the same dead zone in every direction', () => {
    // Per axis it was a square: 0.18 of travel along an axis and 0.255 along a diagonal.
    for (const degrees of [0, 22.5, 45, 67.5, 90, 135, 200]) {
      const inside = shaped(0.179 * Math.sin(rad(degrees)), 0.179 * Math.cos(rad(degrees)));
      const outside = shaped(0.181 * Math.sin(rad(degrees)), 0.181 * Math.cos(rad(degrees)));
      expect(Math.hypot(inside.x, inside.y), `${degrees}° inside`).toBe(0);
      expect(Math.hypot(outside.x, outside.y), `${degrees}° outside`).toBeGreaterThan(0);
    }
  });

  it('starts from standing at the edge of the dead zone rather than jumping to it', () => {
    const edge = shaped(0, 0.185);
    expect(Math.hypot(edge.x, edge.y)).toBeLessThan(0.01);
    let previous = 0;
    for (let push = 0.19; push <= 1; push += 0.01) {
      const out = shaped(0, push);
      expect(out.y).toBeGreaterThan(previous);
      expect(out.y - previous).toBeLessThan(0.02);
      previous = out.y;
    }
    expect(shaped(0, 1).y).toBeCloseTo(1, 9);
  });

  it('stops at the rim on a pad that reports its gate as a square', () => {
    const corner = shaped(1, 1);
    expect(Math.hypot(corner.x, corner.y)).toBeCloseTo(1, 9);
    expect(corner.x).toBeCloseTo(corner.y, 9);
  });

  it('gives slow turns more of the stick with a curve, and keeps the top speed', () => {
    const linear = shaped(0.5, 0, 0.18, 1).x;
    const curved = shaped(0.5, 0, 0.18, 2).x;
    expect(curved).toBeLessThan(linear);
    expect(curved).toBeCloseTo(linear * linear, 9);
    expect(shaped(1, 0, 0.18, 2).x).toBeCloseTo(1, 9);
  });

  it('reads garbage from a runtime as a centred stick', () => {
    expect(shaped(Number.NaN, 0.5)).toEqual({ x: 0, y: 0 });
    expect(shaped(0.5, Number.POSITIVE_INFINITY)).toEqual({ x: 0, y: 0 });
  });
});
