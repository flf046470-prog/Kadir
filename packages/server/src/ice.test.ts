import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { iceServersFor, parseIceConfig } from './ice.js';

describe('ICE servers for voice chat', () => {
  it('sends nothing when nothing is configured, so clients keep their STUN default', () => {
    expect(iceServersFor(parseIceConfig({}), 'p1')).toEqual([]);
  });

  it('serves a static list as given', () => {
    const config = parseIceConfig({ KC_ICE_SERVERS: '[{"urls":"stun:stun.example.org:3478"}]' });
    expect(iceServersFor(config, 'p1')).toEqual([{ urls: 'stun:stun.example.org:3478' }]);
  });

  it('refuses a malformed list at boot rather than sending clients garbage', () => {
    expect(() => parseIceConfig({ KC_ICE_SERVERS: '{"urls":"stun:x"}' })).toThrow();
    expect(() => parseIceConfig({ KC_ICE_SERVERS: '[{"url":"stun:x"}]' })).toThrow();
    expect(() => parseIceConfig({ KC_TURN_URLS: 'turn:relay.example.org:3478' })).toThrow(/SECRET/);
  });

  it("issues coturn REST credentials a relay with the same secret accepts, and never the secret", () => {
    const config = parseIceConfig({ KC_TURN_URLS: 'turn:relay.example.org:3478,turns:relay.example.org:5349', KC_TURN_SECRET: 's3cret', KC_TURN_TTL: '600' });
    const [turn] = iceServersFor(config, 'player-7', 1_000_000);
    expect(turn!.urls).toEqual(['turn:relay.example.org:3478', 'turns:relay.example.org:5349']);
    expect(turn!.username).toBe('1000600:player-7');
    // What coturn computes on its side from `static-auth-secret`.
    expect(turn!.credential).toBe(createHmac('sha1', 's3cret').update('1000600:player-7').digest('base64'));
    expect(JSON.stringify(turn)).not.toContain('s3cret');
    // Per player: one player's credential is not another's.
    expect(iceServersFor(config, 'player-8', 1_000_000)[0]!.credential).not.toBe(turn!.credential);
  });
});
