import { describe, expect, it } from 'vitest';
import { NAV_STICK, PAD, PadEdges, REPEAT_AFTER, REPEAT_EVERY, directionOf, pickNext, type PadSnapshot } from './padNav.js';

function pad(down: number[] = [], axes: number[] = [0, 0, 0, 0]): PadSnapshot {
  return { pressed: (i) => down.includes(i), axes };
}

describe('PadEdges', () => {
  it('counts a button once per press, not once per frame held', () => {
    const edges = new PadEdges();
    expect(edges.update(pad([PAD.confirm]), 1 / 60)).toEqual(['confirm']);
    for (let i = 0; i < 30; i++) expect(edges.update(pad([PAD.confirm]), 1 / 60)).toEqual([]);
    expect(edges.update(pad(), 1 / 60)).toEqual([]);
    expect(edges.update(pad([PAD.confirm]), 1 / 60)).toEqual(['confirm']);
  });

  it('repeats a held direction like a held arrow key', () => {
    const edges = new PadEdges();
    const dt = 1 / 60;
    let moves = 0;
    for (let t = 0; t < 1; t += dt) moves += edges.update(pad([PAD.down]), dt).length;
    // One on the press, then one per REPEAT_EVERY after REPEAT_AFTER.
    const expected = 1 + Math.floor((1 - REPEAT_AFTER) / REPEAT_EVERY) + 1;
    expect(moves).toBeGreaterThanOrEqual(expected - 1);
    expect(moves).toBeLessThanOrEqual(expected);
  });

  it('does not act on the press that opened the screen', () => {
    const edges = new PadEdges();
    edges.absorb(pad([PAD.menu, PAD.confirm]));
    expect(edges.update(pad([PAD.menu, PAD.confirm]), 1 / 60)).toEqual([]);
    expect(edges.update(pad(), 1 / 60)).toEqual([]);
    expect(edges.update(pad([PAD.confirm]), 1 / 60)).toEqual(['confirm']);
  });
});

describe('directionOf', () => {
  it('reads the D-pad and the left stick, ignoring a resting stick', () => {
    expect(directionOf(pad([PAD.left]))).toBe('left');
    expect(directionOf(pad([], [NAV_STICK * 0.8, 0]))).toBeNull();
    expect(directionOf(pad([], [0.9, 0.2]))).toBe('right');
    expect(directionOf(pad([], [0.1, -0.9]))).toBe('up');
    // The right stick is the camera's, never navigation.
    expect(directionOf(pad([], [0, 0, 1, 1]))).toBeNull();
  });
});

describe('pickNext', () => {
  const r = (left: number, top: number, width = 100, height = 40) => ({ left, top, width, height });

  it('moves down a column rather than to a nearer control beside it', () => {
    // A two-column grid: the control below is 60 px down, the one beside it diagonally nearer.
    const from = r(0, 0);
    const candidates = [r(120, 30), r(0, 60)];
    expect(pickNext(from, candidates, 'down')).toBe(1);
  });

  it('finds nothing past the edge', () => {
    expect(pickNext(r(0, 100), [r(0, 0), r(0, 50)], 'down')).toBe(-1);
    expect(pickNext(r(0, 0), [r(0, 50)], 'left')).toBe(-1);
  });

  it('moves down onto a wide slider rather than past it to a checkbox in line', () => {
    // A checkbox at the right-hand end of a row, a wide slider under its label, another checkbox below.
    const from = r(500, 0, 20, 20);
    const slider = r(0, 40, 480, 20);
    const nextCheckbox = r(500, 120, 20, 20);
    expect(pickNext(from, [nextCheckbox, slider], 'down')).toBe(1);
  });

  it('reaches a full-width control under a row of buttons', () => {
    const from = r(220, 0);
    const back = r(0, 80, 400);
    expect(pickNext(from, [r(0, 0), back], 'down')).toBe(1);
  });
});
