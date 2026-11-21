import { describe, expect, it } from 'vitest';

import { cosmetics, oneOf, text } from './gateway.js';

/**
 * The coercions at the trust boundary, tested against values no honest client sends.
 *
 * These exist because of a real remote kill: `{"t":"chat","text":{"toString":"not a function"}}`
 * ended the whole server process. The field was already "defended" — by `String(message.text)` —
 * and that is the lesson worth keeping. `String` reads as a total function and is not: for an
 * object whose `toString` is not callable, the spec falls through to `valueOf`, gets the object
 * back, finds no primitive, and throws. One JSON message, every match on the box over.
 *
 * So what is checked here is not "does it convert" but "does it convert *without throwing*, for
 * every shape a hostile client can put on the wire". Every case below is reachable by a client
 * that has done nothing but join a room.
 */

/** Values a modified client can send. Each one has ended up in a typed parameter at some point. */
const HOSTILE: [string, unknown][] = [
  ['toString not callable', JSON.parse('{"toString": "not a function"}')],
  ['valueOf not callable', JSON.parse('{"valueOf": 1, "toString": null}')],
  ['null-prototype object', Object.assign(Object.create(null), { a: 1 })],
  ['bare object', {}],
  ['array', [1, 2, 3]],
  ['nested array', [[[['deep']]]]],
  ['null', null],
  ['undefined', undefined],
  ['boolean', true],
  ['Infinity (JSON 1e999)', JSON.parse('1e999')],
  ['-Infinity', JSON.parse('-1e999')],
  ['NaN', NaN],
  ['symbol', Symbol('nope')],
  ['function', () => 'no'],
  ['a throwing toString', { toString: () => { throw new Error('boom'); } }],
];

describe('text()', () => {
  it.each(HOSTILE)('never throws on %s', (_label, value) => {
    expect(() => text(value)).not.toThrow();
    expect(typeof text(value)).toBe('string');
  });

  it('throws on the exact payload that used to kill the server, when done the old way', () => {
    // Proof the hazard is real rather than theoretical — and a guard against anyone deciding
    // later that `String()` would have been simpler.
    const payload = JSON.parse('{"toString": "not a function"}');
    expect(() => String(payload)).toThrow(TypeError);
    expect(text(payload)).toBe('');
  });

  it('keeps real strings intact', () => {
    expect(text('hello')).toBe('hello');
    expect(text('  spaces kept  ')).toBe('  spaces kept  ');
    expect(text('日本語とemoji🦘')).toBe('日本語とemoji🦘');
  });

  it('caps length so one message cannot carry a payload', () => {
    expect(text('A'.repeat(10_000), 100)).toHaveLength(100);
    expect(text('A'.repeat(10_000))).toHaveLength(512);
  });

  it('refuses to invent content out of things that were never text', () => {
    // `String({})` is "[object Object]" — a chat line no player typed, shown to everyone in the
    // room as though they had. Empty is the honest answer; the handler rejects it downstream.
    expect(text({})).toBe('');
    expect(text([1, 2])).toBe('');
    expect(text(null)).toBe('');
  });

  it('accepts numbers but not the ones that are not numbers', () => {
    expect(text(42)).toBe('42');
    expect(text(JSON.parse('1e999'))).toBe('');
    expect(text(NaN)).toBe('');
  });
});

describe('oneOf()', () => {
  const kinds = ['offer', 'answer', 'ice', 'leave'] as const;

  it.each(HOSTILE)('falls back rather than throwing on %s', (_label, value) => {
    expect(() => oneOf(value, kinds, 'leave')).not.toThrow();
    expect(kinds).toContain(oneOf(value, kinds, 'leave'));
  });

  it('passes through a legitimate value', () => {
    expect(oneOf('offer', kinds, 'leave')).toBe('offer');
  });

  it('rejects a near miss rather than guessing', () => {
    expect(oneOf('OFFER', kinds, 'leave')).toBe('leave');
    expect(oneOf('offer ', kinds, 'leave')).toBe('leave');
  });
});

describe('cosmetics()', () => {
  it.each(HOSTILE)('returns a plain string map for %s', (_label, value) => {
    expect(() => cosmetics(value)).not.toThrow();
    for (const v of Object.values(cosmetics(value))) expect(typeof v).toBe('string');
  });

  /**
   * The cosmetics map is spread into player state, which is exactly the shape of a prototype
   * pollution bug: `{"__proto__": {"isAdmin": true}}` is valid JSON and a plain-looking object.
   */
  it('drops the keys that would reach Object.prototype', () => {
    const hostile = JSON.parse('{"__proto__": {"polluted": "yes"}, "constructor": {"x": "y"}, "hat": "straw"}');
    const out = cosmetics(hostile);
    expect(out.hat).toBe('straw');
    expect(Object.keys(out)).toEqual(['hat']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('drops values that are not strings', () => {
    expect(cosmetics({ hat: 'straw', trail: { nested: true }, count: 7, bad: null })).toEqual({ hat: 'straw' });
  });

  it('caps how much a client can attach to itself', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 500; i++) many[`slot${i}`] = 'x';
    expect(Object.keys(cosmetics(many)).length).toBeLessThanOrEqual(32);
    expect(cosmetics({ hat: 'A'.repeat(1000) }).hat).toHaveLength(64);
  });
});
