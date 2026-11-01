import type { HudModel } from './hudModel.js';

/** One line of the wrist panel. `tone` picks a colour; the panel owns the actual palette. */
export interface WristLine {
  text: string;
  tone: 'title' | 'normal' | 'dim' | 'warn' | 'selected';
}

/**
 * Every `HudModel` field the wrist panel reads. `wristPanel.test.ts` refuses a model field that is
 * in neither this list nor `WRIST_EXEMPT`, so adding something to the flat HUD cannot silently
 * leave a headset player without it (the same pattern as `event-coverage.test.ts`).
 */
export const WRIST_FIELDS = [
  'headline',
  'timer',
  'roleLabel',
  'tally',
  'bout',
  'scores',
  'charge',
  'cash',
  'armour',
  'slots',
  'status',
  'gadgetsVisible',
] as const satisfies readonly (keyof HudModel)[];

/** Fields deliberately not drawn on the wrist, each with the reason. */
export const WRIST_EXEMPT: Readonly<Partial<Record<keyof HudModel, string>>> = {
  roleClass: 'a CSS class name for the DOM overlay; the wrist shows the label itself',
};

const SCORE_ROWS = 3;
const BAR_CELLS = 10;

/** A charge meter as text, so it needs no second drawing path: `[#####.....]`. */
export function chargeBar(charge: number): string {
  const filled = Math.round(Math.min(1, Math.max(0, charge)) * BAR_CELLS);
  return `[${'#'.repeat(filled)}${'.'.repeat(BAR_CELLS - filled)}]`;
}

/** Turns the HUD model into the few lines that fit a glance at the wrist. Pure: no canvas. */
export function wristLines(m: HudModel): WristLine[] {
  const lines: WristLine[] = [
    { text: `${m.roleLabel}  ${m.timer}`, tone: 'title' },
    { text: m.headline, tone: 'normal' },
  ];
  if (m.tally?.length) lines.push({ text: m.tally.map((t) => t.text).join(' · '), tone: 'dim' });
  if (m.bout) lines.push({ text: `${m.bout.label}  ${m.bout.clock}`, tone: 'warn' });
  if (m.status) lines.push({ text: m.status, tone: 'warn' });
  if (m.charge !== null) lines.push({ text: `Charge ${chargeBar(m.charge)}`, tone: 'normal' });
  if (m.gadgetsVisible) {
    if (m.cash > 0 || m.armour > 0) lines.push({ text: `$${m.cash}  Armour ${m.armour}`, tone: 'dim' });
    for (const s of m.slots) {
      lines.push({
        text: `${s.hint} ${s.name}${s.detail ? ` ${s.detail}` : ''}`,
        tone: s.selected ? 'selected' : s.cooling ? 'dim' : 'normal',
      });
    }
  }
  for (const row of m.scores.slice(0, SCORE_ROWS)) lines.push({ text: `${row.label}  ${row.score}`, tone: 'dim' });
  return lines;
}
