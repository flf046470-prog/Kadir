import { describe, expect, it } from 'vitest';
import { VOICE_FAR, proximityGainAt } from '@kc/core';
import { MAX_VOICE_PEERS, VOICE_CONNECT_RADIUS, VOICE_DROP_RADIUS, planVoicePeers, tuneOpus } from './voiceRange.js';

const at = (x: number, z = 0): { x: number; y: number; z: number } => ({ x, y: 1.6, z });
const me = at(0);

describe('planVoicePeers', () => {
  it('calls players in earshot and nobody beyond it', () => {
    const positions = new Map([
      ['near', at(5)],
      ['edge', at(VOICE_CONNECT_RADIUS - 0.5)],
      ['far', at(VOICE_CONNECT_RADIUS + 5)],
    ]);
    const plan = planVoicePeers(me, positions, new Set());
    expect(plan.connect).toEqual(['near', 'edge']);
    expect(plan.drop).toEqual([]);
  });

  it('connects before a voice can be heard, so nobody audible is ever missing', () => {
    // Anyone the proximity rule would let you hear is inside the connect radius, with headroom.
    expect(proximityGainAt(VOICE_CONNECT_RADIUS)).toBe(0);
    expect(VOICE_CONNECT_RADIUS - VOICE_FAR).toBeGreaterThanOrEqual(8);
  });

  it('keeps a call through the hysteresis band and drops it past it', () => {
    const connected = new Set(['a', 'b']);
    const positions = new Map([
      ['a', at((VOICE_CONNECT_RADIUS + VOICE_DROP_RADIUS) / 2)],
      ['b', at(VOICE_DROP_RADIUS + 1)],
    ]);
    const plan = planVoicePeers(me, positions, connected);
    expect(plan.drop).toEqual(['b']);
    expect(plan.connect).toEqual([]);
  });

  it('never drops a player whose position is missing this frame', () => {
    expect(planVoicePeers(me, new Map(), new Set(['gone-quiet'])).drop).toEqual([]);
  });

  it('caps the mesh at the nearest few, however full the room', () => {
    const positions = new Map<string, ReturnType<typeof at>>();
    for (let i = 0; i < 40; i++) positions.set(`p${i}`, at(1 + (i % 20), i));
    const plan = planVoicePeers(me, positions, new Set());
    expect(plan.connect).toHaveLength(MAX_VOICE_PEERS);
    // Nearest first, and every chosen player is at least as near as every one left out.
    const d = (id: string): number => Math.hypot(positions.get(id)!.x, positions.get(id)!.z);
    const worstChosen = Math.max(...plan.connect.map(d));
    const left = [...positions.keys()].filter((id) => !plan.connect.includes(id) && d(id) <= VOICE_CONNECT_RADIUS);
    for (const id of left) expect(d(id)).toBeGreaterThanOrEqual(worstChosen);
  });

  it('counts existing calls against the cap and skips blocked players', () => {
    const connected = new Set(Array.from({ length: MAX_VOICE_PEERS - 1 }, (_, i) => `c${i}`));
    const positions = new Map([...connected].map((id, i) => [id, at(2 + i)] as const));
    positions.set('blocked', at(1));
    positions.set('new1', at(3));
    positions.set('new2', at(4));
    const plan = planVoicePeers(me, positions, connected, new Set(['blocked']));
    expect(plan.connect).toEqual(['new1']);
  });

  it('is symmetric: both ends reach the same decision', () => {
    const a = at(0);
    const b = at(VOICE_CONNECT_RADIUS - 1, 3);
    const fromA = planVoicePeers(a, new Map([['b', b]]), new Set());
    const fromB = planVoicePeers(b, new Map([['a', a]]), new Set());
    expect(fromA.connect).toEqual(['b']);
    expect(fromB.connect).toEqual(['a']);
  });
});

describe('tuneOpus', () => {
  const sdp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=0',
    'a=rtpmap:63 red/48000/2',
    '',
  ].join('\r\n');

  it('turns on DTX and FEC, mono, at a voice bitrate — keeping what was there', () => {
    const tuned = tuneOpus(sdp);
    const line = tuned.split('\r\n').find((l) => l.startsWith('a=fmtp:111'))!;
    expect(line).toContain('minptime=10');
    expect(line).toContain('useinbandfec=1');
    expect(line).not.toContain('useinbandfec=0');
    expect(line).toContain('usedtx=1');
    expect(line).toContain('stereo=0');
    expect(line).toContain('maxaveragebitrate=28000');
    // Nothing else moved.
    expect(tuned.replace(line, '')).toBe(sdp.replace('a=fmtp:111 minptime=10;useinbandfec=0', ''));
  });

  it('adds an fmtp line when Opus has none, and leaves non-Opus SDP alone', () => {
    const bare = sdp.replace('a=fmtp:111 minptime=10;useinbandfec=0\r\n', '');
    expect(tuneOpus(bare)).toContain('a=fmtp:111 usedtx=1;useinbandfec=1;stereo=0;maxaveragebitrate=28000');
    const noOpus = 'v=0\r\nm=audio 9 RTP/AVP 0\r\na=rtpmap:0 PCMU/8000\r\n';
    expect(tuneOpus(noOpus)).toBe(noOpus);
  });
});
