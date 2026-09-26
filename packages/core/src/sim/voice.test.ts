import { describe, expect, it } from 'vitest';

import { Buttons, createIntent } from '../input/intent.js';
import { mergeSettings } from '../settings/index.js';
import { buildLevel } from '../world/registry.js';
import '../world/index.js';
import '../modes/index.js';
import { Simulation } from './simulation.js';

/**
 * The mouth and the microphone have to agree.
 *
 * Neither end of this had a test, which is how push-to-talk shipped driving the avatar's jaw and
 * nothing else: pressing the key moved the kangaroo's mouth, so it looked like it worked, while
 * the microphone had been live to every peer since permission was granted.
 */
function talkingSim() {
  const level = buildLevel('jungle');
  const sim = new Simulation({ level, modeId: 'training', seed: 4 });
  const player = sim.addPlayer({ id: 'a', name: 'A' });
  sim.stepMany(5);
  return { sim, player };
}

function speak(sim: Simulation, voice: number, buttons = 0) {
  const intent = createIntent();
  intent.tick = sim.tick + 1;
  intent.voice = voice;
  intent.buttons = buttons;
  sim.setIntent('a', intent);
  sim.step();
}

describe('lip sync follows the microphone gate', () => {
  it('moves the mouth for an open mic, with no button held', () => {
    /**
     * The case that was broken. Open mic means nobody ever presses Talk, and the simulation used
     * to require that bit before it would believe the level — so a whole room of players talking
     * on open mics stood there with their mouths shut.
     */
    const { sim, player } = talkingSim();
    speak(sim, 0.6);
    expect(player.voiceLevel).toBeCloseTo(0.6, 5);
  });

  it('keeps the mouth shut when the client reports silence', () => {
    // The client zeroes the level whenever its gate is closed — muted, released, or below the
    // voice-activity threshold — so this one assertion covers all three.
    const { sim, player } = talkingSim();
    speak(sim, 0.6);
    speak(sim, 0);
    expect(player.voiceLevel).toBe(0);
  });

  it('still moves the mouth when Talk is held', () => {
    const { sim, player } = talkingSim();
    speak(sim, 0.7, Buttons.Talk);
    expect(player.voiceLevel).toBeCloseTo(0.7, 5);
  });

  it('never lets a level outside 0..1 through', () => {
    // `voice` arrives from a client and is quantised to a byte on the wire, but a local or
    // hand-rolled client can put anything in the field.
    const { sim, player } = talkingSim();
    speak(sim, 42);
    expect(player.voiceLevel).toBeLessThanOrEqual(1);
    speak(sim, -5);
    expect(player.voiceLevel).toBeGreaterThanOrEqual(0);
    speak(sim, Number.NaN);
    expect(Number.isFinite(player.voiceLevel)).toBe(true);
  });
});

describe('microphone settings come back from storage safely', () => {
  it('defaults to push-to-talk', () => {
    /**
     * A social game wants open mic and most players will switch to it. The default still has to
     * be the mode that cannot embarrass somebody who never opened the panel.
     */
    expect(mergeSettings({}).audio.micMode).toBe('push');
  });

  it('falls back to push-to-talk for a mode it does not recognise', () => {
    // `audio` is merged with Object.assign, so a hand-edited localStorage reaches the field
    // unchecked, and the wrong answer here leaves a microphone open.
    expect(mergeSettings({ audio: { micMode: 'always' } }).audio.micMode).toBe('push');
    expect(mergeSettings({ audio: { micMode: null } }).audio.micMode).toBe('push');
  });

  it('keeps open mic when that is what was stored', () => {
    expect(mergeSettings({ audio: { micMode: 'open' } }).audio.micMode).toBe('open');
  });

  it('clamps a nonsense threshold instead of trusting it', () => {
    expect(mergeSettings({ audio: { micThreshold: 9 } }).audio.micThreshold).toBe(1);
    expect(mergeSettings({ audio: { micThreshold: -1 } }).audio.micThreshold).toBe(0);
    expect(mergeSettings({ audio: { micThreshold: 'loud' } }).audio.micThreshold).toBe(0);
  });

  it('ignores a device id that is not a string', () => {
    expect(mergeSettings({ audio: { micDeviceId: 17 } }).audio.micDeviceId).toBe('');
  });
});
