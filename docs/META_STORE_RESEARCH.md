# What Meta Store players say about the games next to ours

Read on **2026-10-24** from the Meta Horizon Store's own pages (`www.meta.com/experiences/...`),
for the owner's request to reverse-engineer Meta Store VR games and take their reviews into account.
It is **design-level only**: store copy, ratings and player reviews. No binary, asset or code of
anyone else's was looked at, and nothing here copies a mechanic's content. It is a list of what
players reward and punish, held against this game's own code and measured where it could be.

## Sample, and what it can and cannot say

Eleven games chosen for what they share with Kangaroo Chase: arm locomotion and tag (Gorilla Tag,
Capuchin, Scary Baboon, UG, Yeeps), social chaos (Animal Company), VR boxing (The Thrill of the
Fight and its sequel), climbing and cross-play (POPULATION: ONE), a physics ball game (Gym Class)
and the store's best-loved social game (Walkabout Mini Golf).

Each store page renders its **five "most relevant" reviews** and the star histogram of **all**
ratings. So the histograms are the whole population, and the quotes are 55 reviews chosen by
Meta's ranking, weighted by "helpful" votes. That is enough to find what is *loud*, not to measure
how common it is. Every quote below carries its helpful-vote count.

| game | stars | ratings | 5★ | 1★ | comfort | price |
| --- | --- | --- | --- | --- | --- | --- |
| UG | 4.9 | 401K | 93 % | 2 % | Comfortable | free |
| Animal Company | 4.8 | 220K | 90 % | 3 % | Moderate | free |
| Gorilla Tag | 4.4 | 173K | 78 % | 10 % | Moderate | free |
| Yeeps | 4.8 | 87K | 91 % | 3 % | Moderate | $29.99 |
| Scary Baboon | 4.7 | 80K | 86 % | 5 % | Moderate | free |
| Gym Class | 4.8 | 54K | 92 % | 3 % | Comfortable | $19.99 |
| POPULATION: ONE | 4.3 | 16K | 71 % | 11 % | Moderate | free |
| Walkabout Mini Golf | 4.8 | 14K | 92 % | 2 % | Comfortable | $24.99 |
| The Thrill of the Fight | 4.7 | 12K | 84 % | 3 % | Comfortable | $9.99 |
| The Thrill of the Fight 2 | **3.1** | 11K | 38 % | **35 %** | Moderate | $19.99 |
| Capuchin | 4.2 | 8.7K | 68 % | 13 % | Intense | free |

Sources: the store page of each, at the URLs in "Sources" at the end.

## What players punish, and where this game stands

Each finding is: what the reviews say, what our code does, and what was done about it. "Measured"
means a probe or a test in this repository produced the number.

### 1. A fight that rewards flailing over boxing — measured here, fixed

The sharpest number in the sample: the same studio's boxing game fell from **4.7 to 3.1 stars**
between the original and the sequel, with **35 % one-star** ratings. The sequel's top complaints are
all one complaint: damage does not follow technique.

- "punching like a 9 year old with arthritis is how you get your punches to actually do damage …
  me and my 12 years of boxing experience is out weighed by the person whos fighting technique is
  equivalent of a spazzing house cat" (117 helpful)
- "How … are my punches doing the equivalent of slapping someone with a wet napkin with proper form
  and then the dude I'm fighting is throwing straight BS that breaks my guard" (6)
- The original is praised for the reverse: "Guard matters. Punch velocity matters." (3) — and
  criticised for hit feedback: "the sound is not good when you land a punch, and frankly I often
  don't know if I landed a punch" (2).

**Ours had the same defect.** `combat.ts` counted a hand's speed in any direction, inside a hit zone
0.74 m from the head's centre. Measured toe to toe in Boxing (`.probe/flail.ts`):

| VR input | before | after |
| --- | --- | --- |
| committed jab, 0.4 m out at ≈8 m/s | 14.6 damage/s | 14.6 |
| committed jab at ≈4.8 m/s | 8.7 | 8.7 |
| hands at your own guard, 12 cm circles at 14 Hz | **32.8** | 4.9 |
| hands at your own guard, 8 cm circles at 12 Hz | 19.0 | **0** |
| PC punch button, toe to toe | 18.6 | 18.6 |

A punch now lands with the speed at which a **tracked** glove closes on what it hits (full credit
within 35° of straight at it, none past 80°), and lands on the head or the body by which of the two
it is closing on. Button punches are thrown by our own code, aimed where the player looks, and are
left alone: judged the same way they lost two thirds of their damage at 0.7 m, because the throw
runs on through the target. Bot Boxing deals exactly the damage it did (1897 a round, 4 bots × 8).
Tests in `simulation.test.ts` → "punch speed", each mutation-tested.

Hit feedback was already in place: a landed punch has a sound, a haptic pulse and dust; a miss has
its own whoosh (CLAUDE.md, "A punch that missed was silent in every channel").

**Not done — guard.** "Guard matters" is half of what the original is praised for, and this game has
no blocking at all: gloves held in front of the face stop nothing. Backlog A27.

### 2. Bullying, and moderation that can be turned on the victim — fixed in part

The single most-voted review in the sample is a parent's (Animal Company, **2,682 helpful**): their
autistic son "is screaming no help, stop, don't … they even hunt him to kill him". Every social game
has the same thread: "worst community with little kids" (Gorilla Tag, 182), "racist kids" (Scary
Baboon, 481). And moderation tools become the bullies' weapon:

- "they will literally mass report you and votekick you out every single round" (Yeeps, 37)
- "this kid just screamed out the N-word and I got muted" (Gym Class, 206)

**Ours:** proximity voice falls to silence at 22 m; anyone can mute, block and report; moderators
have kick/mute/ban; and an **auto-mute** fires on distinct reporters reaching max(3, 30 % of the
room). The 30 % only bites in a big room. In any room of twelve or fewer the threshold is three,
so **a party of three friends could auto-mute any stranger** — exactly the Yeeps complaint.

Fixed: reports are counted by group, and a group is the reporter's party
(`ReportTracker.record(…, group)`, `SocialService.partyIdOf`). Test: three party members reporting a
stranger mute nobody; two players from outside the party make it three groups, and the mute fires.
Mutation-tested.

Not done: being *hunted* by one player round after round (the Animal Company review) is a mode
question — immunity after a tag exists (`DEFAULT_TAG_RULES`), repeated targeting is not measured.
Backlog A28.

### 3. Modded clients that act on other players — already structural here

- "almost every server i join … there's a modder … they can kick people, lag server … teleport
  Everyone … use soundboards … PLEASE keep AC meta only" (Animal Company, 48)
- "Cheaters allowed to ruin the game" (POPULATION: ONE, 17); "a hacker … spawned a lot of thumpys
  they killed us … using a sound board" (Capuchin)

**Ours:** a client sends only intent (`sanitizeIntent` clamps every field); the server decides every
position, hit, tag, spawn and result, and nothing a client sends can move, kick or spawn anything for
someone else. Hand speed is bounded by a human hand and pose jumps are discarded (CLAUDE.md, "A hand
that jumps is not a pull"). The one channel we cannot police is **voice content** — a soundboard is
just audio on a peer-to-peer stream — so mute and report are the answer there, as in every game in
the sample. The review's "keep it Meta only" is the PC/web risk stated by a player: our web client is
the easiest of all to modify, which is why nothing in it is trusted.

### 4. Bans without a reason, and purchases lost to them — fixed in part

- "I got banned for life because I was using the in-game umbrellas to fly around … I bought a 30
  dollar bundle just a week before the ban" (Scary Baboon, **1,917**)
- "it said i was ban for … profanity. I did not do any of that" (Gorilla Tag, 117)
- "my friend got banned for Anti cheating, which doesn't make any sense" (Gym Class, 10)

**Ours:** nothing bans automatically — the auto-mute is ten minutes and only of chat and voice; bans
are a moderator's, with a duration and a reason. Nothing is ever sold, so a ban cannot take a
purchase with it. **Found and fixed:** a *timed* ban's login refusal said only when it ends, while a
permanent one gave the reason (`ModerationService.admit`); both give the reason now. Test and
mutation in `moderation.test.ts`.

Not done: an appeal. It needs a contact address that only the account holder can provide (B8).

### 5. Monetisation — this game's strongest card, keep it

- "Bundles went from 5 dollars to 10. Then to 20. Then to 30." (Scary Baboon, 68)
- "a cheap … cashgrab … fix the prices" (Gorilla Tag, 35); add-ons there are $29.99 each
- "all you do is add more skins just to make profit" (Gym Class, 43)
- "paid $60 for it and then they make it free to play and don't give anybody … credit" (POP: ONE, 24)
- Praised: "you don't have to own a DLC to play it as long as 1 friend owns the DLC" (Walkabout, 88)

**Ours:** every animal, gadget and launch cosmetic is owned from account creation, season cosmetics
are earned, and `validateCatalog` refuses any money price at boot. That is what the store listings
already lead with, and the reviews say it is the right thing to lead with.

### 6. Updates that change what the game is about — a decision to measure, not make

- "this game was so much more fun before all of the new stuff … Bring it back to the OG" (Gorilla
  Tag, **625**)
- "the fight back update, the mood went from 'WE GOTTA RUN' to 'lets just camp at the safezone'"
  (Scary Baboon, 481)

The second is a mechanism, not nostalgia: giving prey a way to fight turned running into camping.
This game gives runners gadgets in the chase modes. Whether a freeze gun in a runner's hands does the
same is measurable — runner movement with a chaser near, with and without gadgets. Backlog A29.

### 7. Not being able to get in — partly verified

- "I press the agree button … then it just puts me back into the loading screen" (UG, **830**)
- "on days when a lot players online, the servers seem to start not working" (UG, 147)

**Ours:** measured capacity is 1.4 % of a core per 16-player room; rooms refuse past their mode's
own maximum; a PC build that cannot reach the hosted server says why and falls back. What a *web or
Quest* player sees when every room is full or the server is down has not been checked. Backlog A30.

### 8. Comfort and the room around the player — noted

- Heights: "Why are so many tracks on high levels? … I don't like heights" (Walkabout, 8). Our
  canyon walls and serac towers reach 20–28 m; climbing them is optional, but the store's comfort
  label should be honest (Gorilla Tag declares Moderate; Capuchin, Intense, has the lowest stars of
  the arm-locomotion games here).
- Room-scale safety in boxing: "space requirement is a little extreme"; "If you have quest 3, play
  on passthrough mode … you no longer have to worry about hitting walls" (Thrill of the Fight, 106).
  A passthrough option for Boxing is a WebXR `immersive-ar` session — not testable without a headset
  (B6).

## What players reward

- **Easy to pick up, endlessly deep** movement with nothing but the arms (Gorilla Tag's own pitch,
  and the reason most five-star reviews give). Our VR locomotion is the same promise.
- **A workout**: "the best cardio you'll ever have indoors" (Thrill of the Fight, 106). Boxing now
  pays for real technique, which is what makes it exercise rather than flailing.
- **Playing with family at a distance**: a parent of 75 and a daughter, leagues, "meet dozens of
  people all over the world" (Walkabout). Parties, friends and private rooms exist here; seated play
  is supported in VR.
- **Constant, small updates** (UG, Yeeps, Gorilla Tag every two weeks) — and the backlash when an
  update changes the core (§6).

## Backlog these reviews produced

Added to `ROADMAP.md` Track A, each with the measurement that would close it:

- **A27. Guard in Boxing.** Gloves raised in front of the head absorb most of a punch that meets
  them. Exit: a jab into a raised guard lands a fraction of one into an open face, a test on it, and
  a PC answer for players with no hands to raise.
- **A28. Repeated targeting.** How often one player is the target of the same chaser or hunter round
  after round, measured with bots; then a rule if the number is material.
- **A29. Prey that fights back.** Runner distance covered with a chaser within 15 m, with and without
  gadgets, in Kangaroo Chase and Infection.
- **A30. "Can't get in".** What a browser and a Quest player see when the server is down, a room is
  full, or the protocol differs — each a clear message, measured with `check:smoke`-style probes.

And to Track B: **B8. An appeal contact** for bans, at a URL the ban message can name.

## Sources

All read 2026-10-24.

- Gorilla Tag — https://www.meta.com/experiences/gorilla-tag/4979055762136823/
- Animal Company — https://www.meta.com/experiences/animal-company/7190422614401072/
- UG — https://www.meta.com/experiences/ug/8485526434899813/
- Scary Baboon — https://www.meta.com/experiences/scary-baboon/6458628580871969/
- Yeeps — https://www.meta.com/experiences/yeeps/7276525889052788/
- Capuchin — https://www.meta.com/experiences/capuchin/5409297455797322/
- The Thrill of the Fight — https://www.meta.com/experiences/the-thrill-of-the-fight/3008315795852749/
- The Thrill of the Fight 2 — https://www.meta.com/experiences/the-thrill-of-the-fight-2/5479643155418422/
- POPULATION: ONE — https://www.meta.com/experiences/population-one/2564158073609422/
- Gym Class — https://www.meta.com/experiences/gym-class/3661420607275144/
- Walkabout Mini Golf — https://www.meta.com/experiences/walkabout-mini-golf/2462678267173943/
