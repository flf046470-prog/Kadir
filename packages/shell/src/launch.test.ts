import { describe, expect, it } from 'vitest';
import { GAME_PORTS, onlineOriginFor, parseSavedPort, parseSavedSecret, portCandidates } from './launch.js';

describe('keeping the same origin from one launch to the next', () => {
  it('goes back to the port the last launch used before anything else', () => {
    expect(portCandidates(21790)[0]).toBe(21790);
    expect(portCandidates(null)).toEqual([...GAME_PORTS]);
    // A saved port already in the list is not tried twice.
    expect(portCandidates(GAME_PORTS[3]!)).toHaveLength(GAME_PORTS.length);
  });

  it('keeps every fixed port clear of the ranges the OS hands out on its own', () => {
    for (const port of GAME_PORTS) {
      expect(port).toBeLessThan(32768);
      expect(port < 27015 || port > 27050).toBe(true);
      expect(port).not.toBe(8787);
    }
  });

  it('reads back only what it wrote', () => {
    expect(parseSavedPort('21787\n')).toBe(21787);
    for (const junk of [null, '', 'abc', '80', '70000', '21787.5']) expect(parseSavedPort(junk)).toBeNull();
    const secret = 'a'.repeat(64);
    expect(parseSavedSecret(`${secret}\n`)).toBe(secret);
    for (const junk of [null, '', 'short', 'g'.repeat(64)]) expect(parseSavedSecret(junk)).toBeNull();
  });
});

describe('where a PC build plays online', () => {
  const none = () => undefined;
  it('takes the origin the build was packed with', () => {
    expect(onlineOriginFor({ kangarooChase: { onlineOrigin: 'https://play.kangaroo.example' } }, none)).toBe('https://play.kangaroo.example');
    expect(onlineOriginFor({}, none)).toBe('');
  });

  it('lets the environment override it, including with nothing, so a tester can run a build offline', () => {
    const packed = { kangarooChase: { onlineOrigin: 'https://play.kangaroo.example' } };
    expect(onlineOriginFor(packed, (n) => (n === 'KC_ONLINE_ORIGIN' ? 'http://127.0.0.1:9000' : undefined))).toBe('http://127.0.0.1:9000');
    expect(onlineOriginFor(packed, (n) => (n === 'KC_ONLINE_ORIGIN' ? '' : undefined))).toBe('');
  });
});
