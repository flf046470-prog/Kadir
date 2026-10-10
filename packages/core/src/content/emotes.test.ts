import { describe, expect, it } from 'vitest';

import { Simulation } from '../sim/simulation.js';
import { buildJungleWorld } from '../world/jungle.js';
import { Buttons, createIntent } from '../input/intent.js';
import type { InputIntent } from '../input/intent.js';
import { getCosmetic } from './cosmetics.js';
import {
  BUILT_IN_EMOTES,
  EMOTE_CLIPS,
  emoteClip,
  emoteSeconds,
  isEmoteId,
  nextEmote,
  resolveEquippedEmote,
} from './emotes.js';
import '../modes/index.js';

const level = buildJungleWorld();

/**
 * Emotes, which were built everywhere except in the middle.
 *
 * `PlayerState.emoteId` and `emoteTimer` existed, the snapshot codec had a delta field for the id,
 * `locomotion` counted the timer down and cleared the id at zero, a `SimEventType` of `'emote'` was
 * declared, every animal named four emotes, and three emote cosmetics were on sale carrying ids 5,
 * 6 and 7. The button was bound on PC, mobile and VR.
 *
 * Nothing assigned `emoteId`, so the whole chain was inert — and the three cosmetics were items a
 * player could unlock, equip and never see, which is the part that mattered: the promise made about
 * premium content is that it is cosmetic, and a cosmetic that does not render is not cosmetic.
 */
describe('emote numbering', () => {
  it('numbers from one, so zero keeps meaning "not emoting"', () => {
    // The snapshot field and the timer reset in `locomotion` both already assumed this.
    expect(isEmoteId(0)).toBe(false);
    expect(isEmoteId(1)).toBe(true);
    expect(isEmoteId(EMOTE_CLIPS.length)).toBe(true);
    expect(isEmoteId(EMOTE_CLIPS.length + 1)).toBe(false);
    expect(isEmoteId(1.5)).toBe(false);
  });

  it('maps every id to a clip that the models actually carry', () => {
    // The names are the contract with `tools/blender/characters.py`, which bakes exactly these
    // into all seven animals. A mismatch here is an avatar that silently plays nothing.
    for (let id = 1; id <= EMOTE_CLIPS.length; id++) {
      expect(emoteClip(id)).toBe(EMOTE_CLIPS[id - 1]);
      expect(emoteClip(id)).toMatch(/^emote_/);
    }
    expect(emoteClip(0)).toBeNull();
    expect(emoteClip(99)).toBeNull();
  });

  it('gives every id a duration, and the nap the longest one', () => {
    for (let id = 1; id <= EMOTE_CLIPS.length; id++) {
      expect(emoteSeconds(id), `id ${id}`).toBeGreaterThan(0.5);
      expect(emoteSeconds(id), `id ${id}`).toBeLessThan(5);
    }
    // Power Nap is deliberately the long one; the joke is that it takes a while.
    const nap = EMOTE_CLIPS.indexOf('emote_sleep') + 1;
    for (let id = 1; id <= EMOTE_CLIPS.length; id++) {
      if (id !== nap) expect(emoteSeconds(nap)).toBeGreaterThan(emoteSeconds(id));
    }
  });

  it('walks the animal’s own four when nothing is equipped', () => {
    let id = 0;
    const seen: number[] = [];
    for (let i = 0; i < BUILT_IN_EMOTES * 2; i++) {
      id = nextEmote(id, 0);
      seen.push(id);
    }
    expect(seen).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
  });

  it('plays the equipped cosmetic instead of cycling past it', () => {
    // Making a player press through four gestures to reach the one they chose would be a strange
    // reward for having unlocked it.
    expect(nextEmote(0, 6)).toBe(6);
    expect(nextEmote(6, 6)).toBe(6);
    expect(nextEmote(3, 7)).toBe(7);
  });

  it('ignores an equipped id that is not a cosmetic emote', () => {
    // A built-in id in the cosmetic slot must not pin the button to one of the four, and garbage
    // must fall back rather than throw.
    expect(nextEmote(0, 2)).toBe(1);
    expect(nextEmote(0, 99)).toBe(1);
    expect(nextEmote(0, -1)).toBe(1);
  });
});

describe('resolving the equipped emote cosmetic', () => {
  const owned = ['emote_sleep'];

  it('grants the animation of a cosmetic the player owns', () => {
    expect(resolveEquippedEmote({ emote: 'emote_sleep' }, owned, getCosmetic)).toBe(6);
  });

  it('grants nothing for a cosmetic the player does not own', () => {
    /**
     * The whole point of resolving rather than trusting. The loadout was saved at some earlier
     * moment and a refund or a catalogue change since then must not put an item the player no
     * longer owns into a live round — the same rule the gadget loadout follows.
     */
    expect(resolveEquippedEmote({ emote: 'emote_backflip' }, owned, getCosmetic)).toBe(0);
  });

  it('grants nothing for an unknown id, an empty slot, or a non-emote item', () => {
    expect(resolveEquippedEmote({ emote: 'not_a_real_item' }, ['not_a_real_item'], getCosmetic)).toBe(0);
    expect(resolveEquippedEmote({}, owned, getCosmetic)).toBe(0);
    expect(resolveEquippedEmote({ emote: 'trail_dust' }, ['trail_dust'], getCosmetic)).toBe(0);
  });

  it('grants nothing for an item that carries an emote id from another slot', () => {
    /**
     * The slot check, which nothing in the shipped catalogue can exercise: no trail or hat carries
     * an `emoteId`, so every non-emote item already resolves to 0 through the id check alone and
     * the guard survived being deleted. It is worth keeping and therefore worth testing — a hat
     * that animated the wearer because someone reused a field would be a strange bug to chase —
     * so this supplies the lookup rather than pretending the catalogue can.
     */
    const lookup = (id: string) => (id === 'hat_crown' ? { slot: 'head', emoteId: 5 } : undefined);
    expect(resolveEquippedEmote({ emote: 'hat_crown' }, ['hat_crown'], lookup)).toBe(0);
    // And the same item in the emote slot would be granted, so the slot is doing the work.
    const asEmote = (id: string) => (id === 'hat_crown' ? { slot: 'emote', emoteId: 5 } : undefined);
    expect(resolveEquippedEmote({ emote: 'hat_crown' }, ['hat_crown'], asEmote)).toBe(5);
  });

  it('covers every emote cosmetic in the catalogue', () => {
    /**
     * The check that catches a new emote cosmetic being added with an id nothing animates. Every
     * item sold in the emote slot has to resolve to a real animation, or it is an item that cannot
     * be seen — exactly the state all three of these were in.
     */
    for (const id of ['emote_backflip', 'emote_sleep', 'emote_victory']) {
      const resolved = resolveEquippedEmote({ emote: id }, [id], getCosmetic);
      expect(isEmoteId(resolved), `${id} resolved to ${resolved}`).toBe(true);
      expect(emoteClip(resolved), id).not.toBeNull();
    }
  });
});

describe('pressing the emote button', () => {
  function playing(): { sim: Simulation; intent: InputIntent; id: string } {
    const sim = new Simulation({ level, modeId: 'training', seed: 3 });
    sim.addPlayer({ id: 'a', name: 'A' });
    sim.addPlayer({ id: 'b', name: 'B' });
    sim.stepMany(60 * 10);
    return { sim, intent: createIntent(), id: 'a' };
  }

  /** Hold the button for `ticks`, then release for one. */
  function press(sim: Simulation, id: string, intent: InputIntent, ticks = 1): void {
    intent.buttons = Buttons.Emote;
    for (let i = 0; i < ticks; i++) {
      sim.setIntent(id, intent, false);
      sim.step();
    }
    intent.buttons = 0;
    sim.setIntent(id, intent, false);
    sim.step();
  }

  it('starts an emote', () => {
    const { sim, intent, id } = playing();
    const player = sim.players.get(id);
    expect(player?.emoteId).toBe(0);
    press(sim, id, intent);
    expect(player?.emoteId).toBe(1);
    expect(player?.emoteTimer).toBeGreaterThan(0);
  });

  it('emits an event carrying which emote it was', () => {
    const { sim, intent, id } = playing();
    sim.events.drain();
    press(sim, id, intent);
    const emotes = sim.events.drain().filter((e) => e.type === 'emote');
    expect(emotes).toHaveLength(1);
    expect(emotes[0]?.playerId).toBe(id);
    expect(emotes[0]?.magnitude).toBe(1);
  });

  it('ignores a held button, because the press is an edge', () => {
    // The input layers report a held key every frame, and mobile a held touch every frame. This is
    // `handleGadgetButtons`' edge detection doing its job, not the emote guard below.
    const { sim, intent, id } = playing();
    const player = sim.players.get(id);
    intent.buttons = Buttons.Emote;
    for (let i = 0; i < Math.ceil((emoteSeconds(1) + 0.5) * 60); i++) {
      sim.setIntent(id, intent, false);
      sim.step();
    }
    expect(player?.emoteId).toBe(0);
    expect(player?.lastEmote).toBe(1);
  });

  it('will not restart or switch an emote that is already playing', () => {
    /**
     * What the `emoteTimer > 0` guard is actually for — and not what the first version of this
     * test claimed. That one held the button down and asserted the emote ended, which passes with
     * the guard deleted too: a held button is a single rising edge, so edge detection alone
     * already covers it, and the mutation survived.
     *
     * The case the guard exists for is tapping. Without it, a second press mid-animation advances
     * the cycle and cuts the first gesture off a few frames in, so a player drumming the key emits
     * a stutter of half-played poses to everyone watching.
     */
    const { sim, intent, id } = playing();
    const player = sim.players.get(id);
    press(sim, id, intent);
    expect(player?.emoteId).toBe(1);
    const remaining = player?.emoteTimer ?? 0;

    // Tap three more times while the first is still running.
    for (let i = 0; i < 3; i++) press(sim, id, intent);

    expect(player?.emoteId).toBe(1);
    expect(player?.emoteTimer).toBeLessThan(remaining);
  });

  it('clears itself when the animation ends', () => {
    // `locomotion` already did this half; it had nothing to clear.
    const { sim, intent, id } = playing();
    const player = sim.players.get(id);
    press(sim, id, intent);
    expect(player?.emoteId).toBe(1);
    sim.stepMany(Math.ceil((emoteSeconds(1) + 0.2) * 60));
    expect(player?.emoteId).toBe(0);
    expect(player?.emoteTimer).toBe(0);
  });

  it('moves to the next gesture on the next press', () => {
    const { sim, intent, id } = playing();
    const player = sim.players.get(id);
    press(sim, id, intent);
    sim.stepMany(Math.ceil((emoteSeconds(1) + 0.2) * 60));
    press(sim, id, intent);
    expect(player?.emoteId).toBe(2);
  });

  it('plays the equipped cosmetic for a player who has one', () => {
    const sim = new Simulation({ level, modeId: 'training', seed: 3 });
    sim.addPlayer({ id: 'a', name: 'A', equippedEmote: 7 });
    sim.addPlayer({ id: 'b', name: 'B' });
    sim.stepMany(60 * 10);
    const intent = createIntent();
    press(sim, 'a', intent);
    expect(sim.players.get('a')?.emoteId).toBe(7);
  });

  it('refuses an emote id the server did not grant', () => {
    // `addPlayer` is the trust boundary: anything outside the real range is dropped rather than
    // stored, so a bad value cannot reach the wire as an animation nobody has.
    const sim = new Simulation({ level, modeId: 'training', seed: 3 });
    const player = sim.addPlayer({ id: 'a', name: 'A', equippedEmote: 99 });
    expect(player.equippedEmote).toBe(0);
  });

  it('refuses to emote while frozen', () => {
    /**
     * Freezing takes away every way of acting under your own power, and an emote that played
     * through one would be a way to look untouched while being untouchable.
     */
    const { sim, intent, id } = playing();
    const player = sim.players.get(id);
    if (player) player.gadgets.frozen = 3;
    press(sim, id, intent);
    expect(player?.emoteId).toBe(0);
  });

  it('refuses to emote while staggered', () => {
    const { sim, intent, id } = playing();
    const player = sim.players.get(id);
    if (player) player.staggerTimer = 1;
    press(sim, id, intent);
    expect(player?.emoteId).toBe(0);
  });
});
