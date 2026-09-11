/**
 * Proving that a person is who a platform says they are.
 *
 * The same shape as `PurchaseVerifier`, and for the same reason: a token in, a
 * verified identity out, with everything platform-specific behind the line.
 * Meta, Steam and Epic each hand the client a different kind of ticket and each
 * check it differently, and none of that belongs above this interface.
 *
 * **A client saying "I am Steam user 76561…" proves nothing.** That string is
 * public and typeable. What makes a link safe is that the platform confirms the
 * ticket was issued to that identity, for this application, recently — so the
 * verifier, not the client, is what produces the id that gets stored.
 *
 * No drivers exist yet. Writing one needs credentials from a publisher account
 * that does not exist, and a stub that trusted the client would be worse than
 * nothing: it would let anyone claim any platform identity, and identities are
 * what cross-platform entitlement is keyed on.
 */

export const PLATFORMS = ["meta", "steam", "epic"] as const;

export type PlatformId = (typeof PLATFORMS)[number];

export function isPlatform(value: string): value is PlatformId {
  return (PLATFORMS as readonly string[]).includes(value);
}

export type VerifiedPlatformIdentity = {
  platform: PlatformId;
  /** The platform's own id for this person. Stored, never published. */
  platformUserId: string;
  /**
   * A display name, when the platform gives one.
   *
   * Not stored. A member's FioreMatch display name is the one the product
   * shows, and keeping a second one would eventually show a Steam handle on a
   * dating profile.
   */
  displayName?: string;
};

export type PlatformVerifier = {
  readonly name: string;

  /**
   * Verifies a platform ticket.
   *
   * `null` means the ticket is not valid — expired, forged, or issued for a
   * different application. A throw means the platform could not be reached.
   * The distinction is the same one the purchase verifier draws, and matters
   * for the same reason: one is a refusal the client must stop on, the other is
   * worth retrying.
   */
  verify(ticket: string): Promise<VerifiedPlatformIdentity | null>;
};

/** The default: no platform is configured, so nothing can be linked. */
export class NoPlatformVerifier implements PlatformVerifier {
  readonly name = "none";

  async verify(): Promise<VerifiedPlatformIdentity | null> {
    throw new Error("No platform verifier is configured");
  }
}

/**
 * The verifier for a platform, chosen by the deployment.
 *
 * Unconfigured for all three today, so `platformLinkingEnabled` is false and
 * the route answers "unavailable" rather than accepting an unverified claim.
 * When a driver lands it goes here, exactly as the Microsoft Store driver did
 * in `billing/index.ts`.
 */
export function platformVerifier(_platform: PlatformId): PlatformVerifier {
  return new NoPlatformVerifier();
}

export function platformLinkingEnabled(platform: PlatformId): boolean {
  return platformVerifier(platform).name !== "none";
}
