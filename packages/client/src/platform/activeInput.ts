/**
 * Which device the player last touched: the keyboard and mouse, or a controller.
 *
 * Valve's Steam Deck review asks that on-screen glyphs match the input in use, and that keyboard
 * and mouse glyphs are not shown when they are not the active input. "A pad is connected" is not
 * the same question: a PC player with a pad plugged in who plays on the keyboard should see keys,
 * and a Deck (whose controls are always a connected pad) should see buttons until a key is pressed.
 * `PCInput` and `ui/padNav.ts` report what they see; the tutorial reads it when it is drawn.
 */
export type InputDevice = 'none' | 'keys' | 'pad';

let last: InputDevice = 'none';

export function markInput(device: Exclude<InputDevice, 'none'>): void {
  last = device;
}

export function activeInput(): InputDevice {
  return last;
}

/** For tests: forget what was last used. */
export function resetActiveInput(): void {
  last = 'none';
}
