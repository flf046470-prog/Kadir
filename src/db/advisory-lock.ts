/**
 * Keys for `pg_advisory_xact_lock`.
 *
 * Postgres advisory locks are just numbers, so anything that wants to serialise
 * on a string — a user id, an ordered pair — has to hash it down to a signed
 * 64-bit integer first. FNV-1a is used because it is short, dependency-free and
 * deterministic across processes, which is the whole requirement: two servers
 * must derive the same number from the same string or the lock does nothing.
 *
 * Collisions between unrelated keys are harmless by design. The worst case is
 * that two unrelated transactions briefly wait on each other; a collision can
 * never produce a wrong result, only a slower one. Callers must not rely on the
 * key being unique.
 */
export function advisoryLockKey(input: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = (1n << 64n) - 1n;

  for (let i = 0; i < input.length; i++) {
    hash = ((hash ^ BigInt(input.charCodeAt(i))) * prime) & mask;
  }

  // pg advisory locks take a *signed* bigint; fold the top half negative.
  return hash >= 1n << 63n ? hash - (1n << 64n) : hash;
}
