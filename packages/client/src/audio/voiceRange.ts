import { VOICE_FAR } from '@kc/core';

/**
 * Who this client holds a voice connection to.
 *
 * Voice used to be a full mesh: every client opened a peer connection to every other player in
 * the room and uploaded its microphone to each of them. At the 16-player cap that is 15 encoded
 * uploads and 15 decodes per client — ~500 kbps up on a phone or a Quest's Wi-Fi — for voices
 * the proximity rule then turns to silence, because `proximityGainAt` is zero past `VOICE_FAR`.
 * The cost scaled with the room and the benefit scaled with who was nearby.
 *
 * So a connection exists only for players close enough to matter: opened inside
 * `VOICE_CONNECT_RADIUS`, which is `VOICE_FAR` plus enough headroom that a sprinting player's
 * call is up (ICE takes a second or two) before they are loud enough to hear, and closed only past
 * `VOICE_DROP_RADIUS`, so somebody pacing along the boundary does not renegotiate every second.
 * `MAX_VOICE_PEERS` caps the rest: in a crowd the nearest ten are the ones you can make out.
 *
 * The rule is symmetric — both ends measure the same distance, and the gap between the two radii
 * is far wider than two clients' interpolated positions ever disagree by — so both sides reach
 * the same decision without asking each other.
 */
export const VOICE_CONNECT_RADIUS = VOICE_FAR + 10;
export const VOICE_DROP_RADIUS = VOICE_FAR + 18;
export const MAX_VOICE_PEERS = 10;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface VoicePeerPlan {
  /** Nearest first. */
  connect: string[];
  drop: string[];
}

export function planVoicePeers(
  listener: Vec3Like,
  positions: ReadonlyMap<string, Vec3Like>,
  connected: ReadonlySet<string>,
  blocked: ReadonlySet<string> = new Set(),
  max = MAX_VOICE_PEERS,
): VoicePeerPlan {
  const distance = (p: Vec3Like): number => Math.hypot(p.x - listener.x, p.y - listener.y, p.z - listener.z);
  const drop: string[] = [];
  for (const id of connected) {
    const position = positions.get(id);
    // A player with no position this frame keeps their call: a missed snapshot is not a departure,
    // and leaving the room closes the peer through the roster instead.
    if (position && distance(position) > VOICE_DROP_RADIUS) drop.push(id);
  }
  let room = max - (connected.size - drop.length);
  const candidates: { id: string; d: number }[] = [];
  for (const [id, position] of positions) {
    if (connected.has(id) || blocked.has(id)) continue;
    const d = distance(position);
    if (d <= VOICE_CONNECT_RADIUS) candidates.push({ id, d });
  }
  candidates.sort((a, b) => a.d - b.d);
  const connect: string[] = [];
  for (const candidate of candidates) {
    if (room <= 0) break;
    connect.push(candidate.id);
    room--;
  }
  return { connect, drop };
}

/**
 * Opus, set up for a room of mostly-silent people on lossy wireless links.
 *
 * - `usedtx=1`: discontinuous transmission. The push-to-talk gate outputs digital silence, and
 *   without DTX that silence is still encoded and sent as a full 20 ms frame fifty times a second
 *   to every peer. With it, a player who is not talking costs almost nothing.
 * - `useinbandfec=1`: forward error correction, so one lost packet on a headset's Wi-Fi is
 *   reconstructed from the next rather than heard as a click.
 * - `stereo=0`, `maxaveragebitrate=28000`: a voice is mono and 28 kbps is clear speech; the
 *   browser default would spend more on a signal that ends in a panner anyway.
 *
 * Written into the SDP's existing Opus `fmtp` line; a description without Opus is returned as is.
 */
export function tuneOpus(sdp: string): string {
  const rtpmap = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp);
  if (!rtpmap) return sdp;
  const payload = rtpmap[1];
  const wanted: Record<string, string> = { usedtx: '1', useinbandfec: '1', stereo: '0', maxaveragebitrate: '28000' };
  const fmtp = new RegExp(`a=fmtp:${payload} ([^\\r\\n]*)`);
  const match = fmtp.exec(sdp);
  if (!match) {
    const params = Object.entries(wanted).map(([k, v]) => `${k}=${v}`).join(';');
    return sdp.replace(rtpmap[0], `${rtpmap[0]}\r\na=fmtp:${payload} ${params}`);
  }
  const params = new Map<string, string>();
  for (const part of (match[1] ?? '').split(';')) {
    const [k, v] = part.split('=');
    if (k && k.trim()) params.set(k.trim(), (v ?? '').trim());
  }
  for (const [k, v] of Object.entries(wanted)) params.set(k, v);
  const line = [...params].map(([k, v]) => `${k}=${v}`).join(';');
  return sdp.replace(match[0], `a=fmtp:${payload} ${line}`);
}
