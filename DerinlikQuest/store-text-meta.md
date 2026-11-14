# DERİNLİK — Meta Horizon Store text (copy-paste ready)

Limits (Meta Horizon Store submission guide): app name 30 characters, short description 150, long description 4000.
Plain text: the long description supports only basic formatting, so the Steam BBCode is left out.

## App name (8 / 30)

```
DERİNLİK
```

Meta's review requires the exact app title on every branded asset and no taglines (asset design guidelines,
"Exact Title Match"); the covers and logo in `art/` carry "DERİNLİK" alone, so the app name is the same.

## Short description (137 / 150)

```
2028. An email with no sender sends you into a basement before 03.17. First-person VR psychological horror where every choice stays made.
```

## Long description (1699 / 4000)

```
Every choice leaves someone behind.

Ekin Yalın films abandoned buildings for a small channel. Then an email arrives with an empty sender field and only a relay code in its header: "GATE 01 — SAKARYA. Be there before 03.17. After this, no one will believe you."
In the basement, scratched into the wall, are someone else's initials and a date three days old. Ekin is not the first one who was sent.

FOUR PLACES, ONE NETWORK
• Sakarya — The Gate. A damp basement, a stone slab, and knocking from behind a locked door.
• Nevşehir — Memory. A sealed archive in an underground city carved into Cappadocian tuff, and a child only the camcorder can see.
• SIFIR-17, Kola Peninsula. A Soviet research station abandoned in 1986, a resonance experiment, and a lab assistant who no longer sleeps.
• Paris — The Last Witness. The catacombs, a missing child's drawing, and the woman who sent the emails.

CHOICES THAT STAY MADE
Every chapter asks you to decide: who you save, what you record, which frequency you set, who comes through the last door. Each choice changes who is alive, who helps or hunts you, and which ways stay open.

THE CAMCORDER SEES WHAT YOU DON'T
Raise the old DV camcorder in your hand and its night-vision image shows writing, signs and people that are not there to the naked eye.

HIDE. DON'T FIGHT.
You carry no weapon. Switch off the torch in your other hand, crouch in the dark and let it pass.

BUILT FOR VR
• Torch in your left hand, camcorder in your right: point them where you look
• Smooth movement with snap turning, a comfort vignette while moving, and real crouching
• Subtitles and documents on a panel in front of you, in 10 languages

Seven closed endings. No do-overs.
```

## Store settings

| Field | Value | Why |
|---|---|---|
| Category | Games | |
| Genres | Horror, Adventure | |
| Comfort rating | **Moderate** | smooth stick locomotion and sprint, softened by snap turns and the moving vignette (Meta: Comfortable = stationary/teleport, Moderate = smooth locomotion with comfort options) |
| Player mode | Single user | |
| Supported controllers | Touch controllers (hand tracking is requested but not needed for play) | `src/fx-xr.js` |
| Play area | Standing or sitting; roomscale optional | head-tracked crouch, stick movement |
| Age group (upload) | `TEENS_AND_ADULTS` | horror; the IARC questionnaire decides the rating |
| Languages | Interface + subtitles; no voice | same 10 as Steam, after the native-speaker review |
| Privacy policy URL | `https://<DOMAIN>/privacy.html` | `public/privacy.html`; fill in the support e-mail first |
| Internet | Not required | the offline build makes no requests |

IARC answers that follow from the game: frightening themes and disturbing imagery, menacing pursuers, no sexual
content, no graphic gore, no user interaction, no data sharing, no purchases.
