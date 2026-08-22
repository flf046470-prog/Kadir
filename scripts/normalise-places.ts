/**
 * Backfills place ids to slug form.
 *
 * Profiles written before place normalisation hold whatever the member typed,
 * so "Germany" and "germany" are two different countries as far as Discover is
 * concerned. This rewrites the stored values with the same `slugifyPlace` the
 * write path now uses — running the real function, rather than a SQL
 * approximation of it, is what guarantees old rows and new rows agree.
 *
 * Run with: npm run db:normalise-places
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { profiles } from "../src/db/schema";
import { slugifyPlace } from "../src/lib/domain/places";

async function main() {
  const rows = await db
    .select({ userId: profiles.userId, cityId: profiles.cityId, countryId: profiles.countryId })
    .from(profiles);

  let changed = 0;

  for (const row of rows) {
    const cityId = row.cityId ? slugifyPlace(row.cityId) : null;
    const countryId = row.countryId ? slugifyPlace(row.countryId) : null;

    if (cityId === row.cityId && countryId === row.countryId) continue;

    await db
      .update(profiles)
      // A country that slugifies to nothing keeps its old value rather than
      // being nulled: losing a member's country is worse than an odd id.
      .set({ cityId, countryId: countryId ?? row.countryId })
      .where(eq(profiles.userId, row.userId));

    changed += 1;
  }

  console.log(`normalised ${changed} of ${rows.length} profiles`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
