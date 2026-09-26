/**
 * When the microphone is actually transmitting.
 *
 * All three platforms advertise a push-to-talk control — "Hold the left thumbstick in" in VR,
 * KeyV on PC, a held mic button on mobile — and none of them reached the microphone. The bit
 * travelled in the intent and gated the *avatar's mouth*, nothing more: measured across the whole
 * client, `VoiceChat.setMuted` had no caller at all, so from the moment a player granted the
 * microphone it was live to every peer in the room whatever they were holding. That is not a
 * missing feature, it is a player being recorded by their teammates while they believe they are
 * not, and it is the kind of thing a store review is entitled to fail a build for.
 *
 * The decision lives here rather than in the client because it is pure arithmetic over a handful
 * of numbers, and because a microphone is the one system where "I tested it by hand and it seemed
 * fine" is worth nothing — it needs cases, and cases need a function you can call.
 */

/**
 * How the microphone opens.
 *
 * `push` is the safe default for a game people play in their living room: silent until you ask
 * for it, and silent again the instant you let go. `open` is what a social game actually wants —
 * nobody holds a key through a conversation — so it is offered with a voice gate in front of it
 * rather than not offered at all.
 */
export type MicMode = 'push' | 'open';

/**
 * Seconds an open mic stays live after you stop being loud.
 *
 * Without it the gate closes between words and clips the tail of every sentence, which is the
 * failure everyone recognises from cheap voice chat. 0.45 s spans an ordinary between-word pause
 * and is short enough that the room does not hear you put your headset down.
 */
export const MIC_HANGOVER = 0.45;

/**
 * The open gate holds until loudness falls to this fraction of the threshold.
 *
 * Hysteresis. A single threshold with speech hovering either side of it chatters the gate on and
 * off several times a second, which sounds far worse than either state.
 */
export const MIC_RELEASE_RATIO = 0.65;

/** Default voice-activity threshold, as a fraction of the 0..1 level meter. */
export const DEFAULT_MIC_THRESHOLD = 0.08;

export interface MicGateInput {
  mode: MicMode;
  /** Is the platform's Talk control held this frame? */
  talkHeld: boolean;
  /** Smoothed microphone loudness, 0..1, as the level meter reports it. */
  level: number;
  /** Voice-activity threshold, 0..1. */
  threshold: number;
  /** The player has muted themselves. Beats everything. */
  muted: boolean;
}

/**
 * Decides, frame by frame, whether the microphone should be transmitting.
 *
 * Stateful because the open-mic hangover is a timer, and deterministic given `dt` so a test can
 * drive it a frame at a time without a clock.
 */
export class MicGate {
  /** Seconds of hangover left. Above zero means the gate is being held open by the timer. */
  private hangover = 0;
  private open = false;

  /** Is the microphone live right now? */
  get isOpen(): boolean {
    return this.open;
  }

  /** Seconds of hangover remaining, for a HUD that wants to show the gate closing. */
  get remainingHangover(): number {
    return this.hangover;
  }

  /**
   * Advance by `dt` seconds and return whether the microphone should transmit.
   *
   * Push-to-talk gets no hangover on purpose. A hangover is a kindness to a sentence and a
   * betrayal of a key release: someone lets go of Talk precisely because they are about to say
   * something they do not want the room to hear, and half a second is long enough to say it.
   */
  update(dt: number, input: MicGateInput): boolean {
    if (input.muted) {
      this.hangover = 0;
      this.open = false;
      return false;
    }

    if (input.mode === 'push') {
      this.hangover = 0;
      this.open = input.talkHeld;
      return this.open;
    }

    // Open mic. The Talk control still works, and overrides the gate: it is the way to be heard
    // when you are speaking too quietly for the threshold, which is the one complaint a voice
    // gate reliably produces.
    if (input.talkHeld) {
      this.hangover = MIC_HANGOVER;
      this.open = true;
      return true;
    }

    const threshold = clamp01(input.threshold);
    if (input.level >= threshold) {
      this.hangover = MIC_HANGOVER;
      this.open = true;
      return true;
    }

    if (this.open && input.level >= threshold * MIC_RELEASE_RATIO) {
      // Still in the hysteresis band: hold the gate open without refreshing the timer, so a voice
      // trailing off still closes rather than hovering here forever.
      return true;
    }

    this.hangover = Math.max(0, this.hangover - Math.max(0, dt));
    this.open = this.hangover > 0;
    return this.open;
  }

  /** Slam it shut. Used when voice is switched off, or the player leaves a match. */
  reset(): void {
    this.hangover = 0;
    this.open = false;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
