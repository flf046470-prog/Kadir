import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db/client";
import { register } from "@/auth/accounts";
import { createSession } from "@/auth/session";
import { approvePhoto, uploadPhoto } from "@/db/photos";
import {
  matches,
  messages,
  profileAttributes,
  profiles,
  users
} from "@/db/schema";

/**
 * The demo data the store screenshots are shot against.
 *
 * Store captures used to be made by hand against whatever happened to be in a
 * development database. That is why the pricing screenshot went stale without
 * anyone noticing: there was no command to re-run, so "re-shoot the
 * screenshots" was a thing somebody had to remember rather than a thing that
 * either succeeded or failed. This is the missing half of `capture.mjs`.
 *
 * The cast is chosen to make the product's actual claim visible. Every
 * candidate shares something specific and *different* with the viewer, so the
 * reason printed on each Discover card is a real reason rather than the same
 * one five times, and the conversation is with someone who speaks no Turkish —
 * which is the entire point of the listing and cannot be demonstrated by two
 * people who share a language.
 *
 * Destructive: it deletes the accounts it owns before recreating them, so the
 * output is the same every run. It refuses to touch anything else.
 *
 * Run with: npm run seed:demo
 */

/**
 * The marker that says an account belongs to this script.
 *
 * Deleting by domain rather than by a list of ids is what keeps the script
 * re-runnable after it has been edited: renaming a character would otherwise
 * orphan the old row, and Discover would show both.
 */
const DEMO_DOMAIN = "@demo.fiorematch.test";
const PASSWORD = "demo-account-not-for-humans";

type Character = {
  handle: string;
  displayName: string;
  birthdate: string;
  countryId: string;
  cityId: string;
  relationshipGoal: string;
  languages: string[];
  interests: string[];
  bio: string;
};

/** The member the screenshots are taken as. */
const VIEWER: Character = {
  handle: "deniz",
  displayName: "Deniz",
  birthdate: "1996-04-11",
  countryId: "turkey",
  cityId: "istanbul",
  relationshipGoal: "long_term",
  languages: ["tr"],
  interests: ["seyahat", "müzik", "yemek"],
  bio: "Kadıköy'de yaşıyorum, hafta sonları yürüyüşe çıkarım."
};

/**
 * Deliberately only Turkish above.
 *
 * A viewer who also speaks English would match half of these on language, and
 * the translation banner — the thing being sold — would never appear, because
 * there would be a shared language to fall back on.
 */
const CANDIDATES: Character[] = [
  {
    handle: "lena",
    displayName: "Lena",
    birthdate: "1995-09-02",
    countryId: "germany",
    cityId: "berlin",
    relationshipGoal: "long_term",
    languages: ["de"],
    interests: ["Musik", "Radfahren", "Kochen"],
    bio: "Ich koche gern und fahre am Wochenende raus aus der Stadt."
  },
  {
    handle: "mateo",
    displayName: "Mateo",
    birthdate: "1993-01-27",
    countryId: "spain",
    cityId: "valencia",
    relationshipGoal: "long_term",
    languages: ["es"],
    interests: ["viajes", "fotografía"],
    bio: "Fotografía y viajes. Busco algo que dure."
  },
  {
    handle: "yuki",
    displayName: "Yuki",
    birthdate: "1997-06-19",
    countryId: "japan",
    cityId: "osaka",
    relationshipGoal: "long_term",
    languages: ["ja"],
    interests: ["料理", "音楽"],
    bio: "料理と音楽が好きです。ゆっくり知り合いたい。"
  },
  {
    handle: "elif",
    displayName: "Elif",
    birthdate: "1994-11-08",
    countryId: "turkey",
    cityId: "istanbul",
    relationshipGoal: "long_term",
    languages: ["tr", "en"],
    interests: ["seyahat", "yemek"],
    bio: "İstanbul'da büyüdüm, seyahat etmeyi seviyorum."
  },
  {
    handle: "chiara",
    displayName: "Chiara",
    birthdate: "1996-02-14",
    countryId: "italy",
    cityId: "bologna",
    relationshipGoal: "long_term",
    languages: ["it"],
    interests: ["musica", "ciclismo"],
    bio: "Suono il basso. Cerco qualcuno con cui uscire davvero."
  },
  {
    handle: "amelie",
    displayName: "Amélie",
    birthdate: "1995-07-30",
    countryId: "france",
    cityId: "lyon",
    relationshipGoal: "long_term",
    languages: ["fr"],
    interests: ["cuisine", "photographie"],
    bio: "Je cuisine beaucoup trop pour une seule personne."
  }
];

/**
 * The conversation shown in the messages screenshot.
 *
 * German, from someone whose profile says she speaks only German, to a viewer
 * whose profile says he speaks only Turkish. That combination is what makes the
 * translation banner appear at all — the feature turns itself on when two
 * people share no language, so a seeded conversation between two English
 * speakers would produce a screenshot of the feature switched off.
 */
const CONVERSATION: { from: "them" | "us"; body: string; language: string }[] = [
  { from: "them", body: "Hallo! Dein Profil hat mich zum Lächeln gebracht.", language: "de" },
  { from: "us", body: "Merhaba Lena! Seninki de öyle.", language: "tr" },
  { from: "them", body: "Wie ist das Wetter gerade in Istanbul?", language: "de" },
  { from: "us", body: "Bugün çok güzel, sahilde yürüdüm.", language: "tr" },
  {
    from: "them",
    body: "Das klingt schön. Ich war noch nie dort, würde aber gern mal hin.",
    language: "de"
  }
];

async function reset(): Promise<void> {
  const existing = await db.select({ id: users.id, email: users.email }).from(users);
  const demo = existing.filter((row) => row.email.endsWith(DEMO_DOMAIN));

  // Everything member-owned cascades from `users`, so this one delete is the
  // whole cleanup — see the schema's note on deletion being complete.
  for (const row of demo) await db.delete(users).where(eq(users.id, row.id));

  if (demo.length > 0) console.log(`  removed ${demo.length} accounts from a previous run`);
}

/**
 * Two approved photos each, through the real upload path.
 *
 * The demo cast had none, and a dating product with no faces on it is not a
 * demo of anything — it is also what the store screenshots were being shot
 * against, which is worse, because a Discover screenshot full of blank cards is
 * the listing telling a reviewer the app is empty.
 *
 * Deliberately `uploadPhoto` and `approvePhoto` rather than inserted rows.
 * Inserted rows can name a file that was never written, which is exactly the
 * fixture bug this replaces: the row exists, the page renders an `<img>`, and
 * the request 404s. Going through the pipeline means the bytes are processed,
 * stripped, content-addressed and stored the way a member's would be, so what
 * the screenshots and the browser tests see is what a member sees.
 *
 * Plain gradients rather than faces of people who did not consent to being in
 * anyone's store listing — §32's licensing rule applied to the obvious case.
 * The colour is derived from the name so each member differs and every run
 * produces the same set.
 */
async function givePhotos(userId: string, displayName: string): Promise<void> {
  const hue = [...displayName].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;

  for (let index = 0; index < 2; index += 1) {
    const image = await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 3,
        background: { r: 0, g: 0, b: 0 }
      }
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
               <defs>
                 <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                   <stop offset="0%" stop-color="hsl(${(hue + index * 40) % 360},62%,68%)"/>
                   <stop offset="100%" stop-color="hsl(${(hue + 70 + index * 40) % 360},58%,34%)"/>
                 </linearGradient>
                 <radialGradient id="glow" cx="0.5" cy="0.36" r="0.5">
                   <stop offset="0%" stop-color="#fff" stop-opacity="0.30"/>
                   <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
                 </radialGradient>
               </defs>
               <rect width="1024" height="1024" fill="url(#g)"/>
               <rect width="1024" height="1024" fill="url(#glow)"/>
               <!--
                 A shoulders-and-head silhouette, so the card reads as an avatar
                 that is deliberately abstract rather than as an image that
                 failed to load. A flat rectangle of colour looks like a loading
                 state, and a store reviewer seeing one on every card reasonably
                 concludes the app is broken.
               -->
               <circle cx="512" cy="404" r="150" fill="#fff" fill-opacity="0.22"/>
               <path d="M232 1024c0-155 125-281 280-281s280 126 280 281z"
                     fill="#fff" fill-opacity="0.22"/>
             </svg>`
          ),
          top: 0,
          left: 0
        }
      ])
      .jpeg()
      .toBuffer();

    const uploaded = await uploadPhoto(userId, image);
    // A failure here is a broken seed, not a member's bad upload — the fixture
    // is generated a line above and is known good, so this cannot be shrugged off.
    if (!uploaded.ok) throw new Error(`seeding a photo failed: ${uploaded.reason}`);
    await approvePhoto(uploaded.photo.id);
  }
}

async function create(character: Character): Promise<string> {
  const result = await register({
    email: `${character.handle}${DEMO_DOMAIN}`,
    password: PASSWORD,
    displayName: character.displayName,
    birthdate: character.birthdate,
    countryId: character.countryId
  });

  if (!result.ok) {
    throw new Error(
      `${character.handle}: ${result.errors.map((e) => `${e.field} ${e.code}`).join(", ")}`
    );
  }

  const userId = result.userId;

  await db
    .update(profiles)
    .set({
      cityId: character.cityId,
      relationshipGoal: character.relationshipGoal,
      bio: character.bio,
      // Discover skips an incomplete profile, so an unset value here is an
      // empty screenshot with no explanation of why.
      completedAt: new Date()
    })
    .where(eq(profiles.userId, userId));

  await db.insert(profileAttributes).values([
    ...character.languages.map((value) => ({ userId, kind: "language_spoken", value })),
    ...character.interests.map((value) => ({ userId, kind: "interest", value })),
    { userId, kind: "match_intent", value: "serious_relationship" }
  ]);

  return userId;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  /**
   * A guard, not a formality.
   *
   * This script deletes accounts. It is meant for a development database and a
   * capture run, and the failure mode if it is ever pointed at production is
   * not recoverable, so it refuses rather than trusting the operator to have
   * checked which shell they were in.
   */
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed:demo refuses to run with NODE_ENV=production");
  }

  console.log("Seeding demo data\n");
  await reset();

  const viewerId = await create(VIEWER);
  await givePhotos(viewerId, VIEWER.displayName);
  console.log(`  ${VIEWER.displayName.padEnd(10)} viewer`);

  const ids = new Map<string, string>();
  for (const character of CANDIDATES) {
    const id = await create(character);
    ids.set(character.handle, id);
    await givePhotos(id, character.displayName);
    console.log(`  ${character.displayName.padEnd(10)} ${character.languages.join("/")}`);
  }

  /**
   * The match, written in the pair order the unique index expects.
   *
   * `matches_pair_unique` is on (a, b) as given rather than on a normalised
   * pair, so inserting the same two people in the other order would be a second
   * row the constraint does not catch. Sorting here is what makes the seed
   * idempotent against a table that already holds the reverse.
   */
  const lenaId = ids.get("lena")!;
  const [userAId, userBId] = [viewerId, lenaId].sort();
  const [match] = await db.insert(matches).values({ userAId, userBId }).returning({
    id: matches.id
  });

  // Spaced a minute apart so the thread renders in the order it was written;
  // inserting them in one statement gives every row the same `defaultNow()`.
  const start = Date.now() - CONVERSATION.length * 60_000;
  await db.insert(messages).values(
    CONVERSATION.map((line, index) => ({
      matchId: match.id,
      senderId: line.from === "us" ? viewerId : lenaId,
      body: line.body,
      language: line.language,
      createdAt: new Date(start + index * 60_000)
    }))
  );

  console.log(`\n  match with Lena, ${CONVERSATION.length} messages`);

  const { token } = await createSession(viewerId);
  console.log(`\nSession cookie for the capture run:\n  fm_session=${token}\n`);

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
