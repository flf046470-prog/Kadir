/**
 * Attribution registry.
 *
 * Some licences we can ship under (CC-BY, and most asset-store EULAs) require the work to be
 * credited in the product. That is a shipping requirement, not paperwork: a build that serves a
 * CC-BY model without naming its author is not licensed to be sold. So attribution lives in
 * data next to the asset reference, and the credits screen is generated from it — there is no
 * hand-maintained list to fall out of date when a pack is swapped.
 *
 * `assets/packs.json` is the source of truth for downloaded packs; `scripts/fetch-assets.mjs`
 * regenerates `ASSET_PACK_CREDITS` from it so the two can never disagree.
 */

export type LicenceId = 'CC0-1.0' | 'CC-BY-4.0' | 'CC-BY-3.0' | 'MIT' | 'Apache-2.0' | 'proprietary';

export interface Credit {
  /** What is being credited — a pack name, a library, a single model. */
  work: string;
  /** Who made it. Required for every licence that is not CC0. */
  author: string;
  licence: LicenceId;
  /** Where the original lives, so a claim can be checked. */
  sourceUrl?: string;
  /** Free-form note, e.g. "model CC0, rigging CC-BY 4.0". */
  note?: string;
}

/** True when the licence obliges us to name the author in the shipped product. */
export function requiresAttribution(licence: LicenceId): boolean {
  return licence !== 'CC0-1.0';
}

const credits: Credit[] = [];

export function registerCredits(entries: readonly Credit[]): void {
  for (const entry of entries) {
    if (requiresAttribution(entry.licence) && !entry.author.trim()) {
      throw new Error(`Credit for "${entry.work}" is under ${entry.licence} but names no author`);
    }
    if (credits.some((c) => c.work === entry.work && c.author === entry.author)) continue;
    credits.push(entry);
  }
}

export function listCredits(): Credit[] {
  return [...credits].sort((a, b) => a.work.localeCompare(b.work));
}

/** Credits that a licence legally requires us to show. Used by the compliance test. */
export function mandatoryCredits(): Credit[] {
  return listCredits().filter((c) => requiresAttribution(c.licence));
}

export function clearCredits(): void {
  credits.length = 0;
}

/** Runtime dependencies that ship inside the client bundle. */
export const ENGINE_CREDITS: readonly Credit[] = [
  { work: 'three.js', author: 'three.js authors', licence: 'MIT', sourceUrl: 'https://github.com/mrdoob/three.js' },
];

/**
 * Art packs installed by `npm run assets:fetch`.
 *
 * Regenerated from `assets/packs.json`; edit that file, not this list. The entries stay here
 * even when the files are not installed, because the credits screen must describe the build
 * that ships, and a pack is either in the manifest for a release or it is not.
 */
export const ASSET_PACK_CREDITS: readonly Credit[] = [
  {
    work: 'Fox (glTF sample asset)',
    author: 'PixelMannen; rigging & animation by tomkranis; glTF conversion by @AsoboStudio and @scurest',
    licence: 'CC-BY-4.0',
    sourceUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox',
    note: 'Model is CC0-1.0; the rigging, animation and glTF conversion are CC-BY-4.0, so the pack as shipped requires attribution.',
  },
  // CC0 imposes no attribution obligation. These are credited anyway: the packs exist because
  // their authors chose to give the work away, and a credits screen that lists only what we are
  // legally forced to list is a worse credits screen.
  {
    work: 'Ultimate Animated Animals',
    author: 'Quaternius',
    licence: 'CC0-1.0',
    sourceUrl: 'https://quaternius.com/packs/ultimateanimatedanimals.html',
  },
  {
    work: 'Universal Animation Library',
    author: 'Quaternius',
    licence: 'CC0-1.0',
    sourceUrl: 'https://quaternius.com/packs/universalanimationlibrary.html',
  },
  {
    work: 'Stylised Nature / Jungle kit',
    author: 'Quaternius',
    licence: 'CC0-1.0',
    sourceUrl: 'https://quaternius.com/',
  },
  {
    work: 'Nature Kit',
    author: 'Kenney',
    licence: 'CC0-1.0',
    sourceUrl: 'https://kenney.nl/assets/nature-kit',
  },
  {
    work: 'Impact Sounds',
    author: 'Kenney',
    licence: 'CC0-1.0',
    sourceUrl: 'https://kenney.nl/assets/impact-sounds',
  },
];

registerCredits(ENGINE_CREDITS);
registerCredits(ASSET_PACK_CREDITS);
