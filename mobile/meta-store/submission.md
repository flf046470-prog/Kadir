# Meta Horizon Store — submission

## What is in this folder

`npm run store:meta` writes six images into `assets/`, at Meta's sizes:

| File | Size | Where the store shows it |
| --- | --- | --- |
| `app-icon-512x512.png` | 512×512 | the headset's own app grid |
| `cover-landscape-2560x1440.png` | 2560×1440 | the primary store cover |
| `cover-portrait-1008x1440.png` | 1008×1440 | portrait shelves |
| `cover-square-1440x1440.png` | 1440×1440 | square placements |
| `hero-2560x1440.png` | 2560×1440 | the banner at the top of the listing |
| `logo-1440x720.png` | 1440×720 | overlaid on that banner — transparent |

All drawn from `scripts/brand-mark.mjs`, so they cannot drift from the app icon.

The lockup sits left of centre on the hero because the storefront draws its own
title and buttons over the right of it — the same reason it does on Steam.

## What is not here, and cannot be

**The build.** The Horizon Store distributes an Android package built for the
headset, and FioreMatch has no Quest build.
[`../../docs/BUILDS.md`](../../docs/BUILDS.md) lists Meta Quest as needing
Unity, and that has not started.

Worth being exact about why the existing Android build does not substitute:
the Quest runs Android, but a 2D phone app submitted to the Horizon Store is
judged as a VR application and rejected. What would ship is either a genuine VR
client or a 2D panel app, and the second is a category Meta has been closing
rather than opening.

## What is already done, and is not nothing

The server half of the VR product exists. Virtual dates — invitations,
scheduling, accepting, the room record — are built, tested and behind a flag,
and none of it needs a headset:
[`../../docs/VR_SETUP.md`](../../docs/VR_SETUP.md) describes what a client would
be handed. A date is rows and rules; a headset joins a room the server has
already decided should exist.

So the missing piece is a client, not a system.

## Decisions this needs

**1. Unity, and which headset first.** A licence tier and a target. This one
blocker covers four build targets — Quest, Windows PC VR, Steam and Epic — so it
is one decision, not four.

**2. A verified developer organisation.** Meta requires organisation
verification with a legal entity before a store submission, and the Horizon
Store proper is curated — App Lab, the unreviewed route, was folded into the
main store, so there is no longer a side door.

**3. The content policy question.** Meta's rules on social and dating
applications in VR are stricter than the phone stores', particularly around
adults meeting strangers in embodied spaces and around who may be present.
`docs/VOICE.md` already carries an unresolved question that lands here: what a
report from inside a live voice date can be when nothing is recorded. In VR
that question is sharper, not softer, and it should be answered before a
submission rather than during review.

That is a **store policy risk**, and under the standing instruction it is
reported rather than worked around.

## Recommendation

Keep the art, park the store, and treat Unity as one decision covering all four
VR-adjacent targets. [`../../docs/LAUNCH_ORDER.md`](../../docs/LAUNCH_ORDER.md)
puts it in Stage 6, after there are members — the web application and the two
phone shells are the product, and a headset client is an expansion that should
be decided with real usage numbers rather than before any exist.
