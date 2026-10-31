import { describe, expect, it } from 'vitest';
import { HIDDEN_CHAT, StreamerMask } from './streamer.js';

describe('streamer mode', () => {
  it('shows everything as it is while it is off', () => {
    const m = new StreamerMask('me');
    expect(m.name('a', 'Bounce')).toBe('Bounce');
    expect(m.code('KANG-QB9T')).toBe('KANG-QB9T');
    expect(m.chat('hello', false)).toBe('hello');
    expect(m.text('Bounce knocked out Digger')).toBe('Bounce knocked out Digger');
  });

  it('gives other players a stable alias and keeps the streamer as they are', () => {
    const m = new StreamerMask('me');
    m.enabled = true;
    expect(m.name('me', 'Kadir')).toBe('Kadir');
    const a = m.name('a', 'Bounce');
    const b = m.name('b', 'Digger');
    expect(a).not.toBe(b);
    expect(a).not.toContain('Bounce');
    // The same person keeps the same alias, even if their name changes mid-session.
    expect(m.name('a', 'Bounce2')).toBe(a);
  });

  it('masks room codes wherever they are printed', () => {
    const m = new StreamerMask('me');
    m.enabled = true;
    expect(m.code('KANG-QB9T')).toBe('KANG-••••');
    expect(m.text('Following Bounce into KANG-QB9T')).not.toContain('QB9T');
  });

  it("hides other players' chat, not the streamer's own or the game's notices", () => {
    const m = new StreamerMask('me');
    m.enabled = true;
    expect(m.chat('rude words', false)).toBe(HIDDEN_CHAT);
    expect(m.chat('gg', true)).toBe('gg');
    expect(m.chat('You are muted', false, true)).toBe('You are muted');
  });

  it('replaces whole names inside text, longest first, and leaves the game its own words', () => {
    const m = new StreamerMask('me');
    m.enabled = true;
    const bounce = m.name('a', 'Bounce');
    const junior = m.name('b', 'Bounce Jr');
    m.name('c', 'Roo');
    expect(m.text('Bounce Jr knocked out Bounce')).toBe(`${junior} knocked out ${bounce}`);
    // Not inside another word.
    expect(m.text('Bouncer is not a player')).toBe('Bouncer is not a player');
    // The default name is a word the game prints; masking it would only mangle the mode's name.
    expect(m.text('Roo Ball: Roo scores')).toBe('Roo Ball: Roo scores');
  });

  it('switches back without forgetting who is who', () => {
    const m = new StreamerMask('me');
    m.enabled = true;
    const alias = m.name('a', 'Bounce');
    m.enabled = false;
    expect(m.name('a', 'Bounce')).toBe('Bounce');
    m.enabled = true;
    expect(m.name('a', 'Bounce')).toBe(alias);
  });
});
