/**
 * Hold-to-act, or press-to-toggle.
 *
 * `controls.holdToGrab` was declared, documented as "Mobile/PC: hold vs toggle for grab",
 * defaulted to true and read by nothing — so the one control that makes climbing possible for a
 * player who cannot hold a mouse button through a thirty-second ascent did nothing at all.
 *
 * Written once and used by both non-VR platforms rather than twice, for the same reason every
 * other rule in this game lives in one place. VR has no use for it: a hand grabs because it is
 * closed around something, and there is no button to hold.
 */
export class HoldOrToggle {
  private latched = false;
  private wasPressed = false;

  /**
   * @param pressed the button's live state this sample
   * @param hold true for hold-to-act, false for press-to-toggle
   */
  update(pressed: boolean, hold: boolean): boolean {
    if (hold) {
      // Leaving toggle mode must not strand the latch on: a player who switches the setting
      // mid-session would otherwise be holding a grab they cannot release.
      this.latched = false;
      this.wasPressed = pressed;
      return pressed;
    }
    // Rising edge only. Reading the level would toggle once per frame for as long as the button
    // is down, which on a 60 Hz sample is a grab that flickers rather than one that holds.
    if (pressed && !this.wasPressed) this.latched = !this.latched;
    this.wasPressed = pressed;
    return this.latched;
  }

  /** Drop the latch — for a respawn, a mode change, or losing focus mid-grab. */
  reset(): void {
    this.latched = false;
    this.wasPressed = false;
  }
}
