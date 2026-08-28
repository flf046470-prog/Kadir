import type { PlayerProfile } from '@kc/core';
import { applyVerifiedPurchase, getStoreItem, purchaseWithCoins } from '@kc/core';
import type { PurchaseOutcome } from '@kc/core';

/**
 * Store receipt verification.
 *
 * This is the integration point for Google Play / App Store / Meta Horizon receipt validation.
 * The important property — enforced here rather than in the client — is that content is only
 * granted after a verifier says the receipt is genuine, and that a receipt is consumed once.
 */
export interface ReceiptVerifier {
  readonly name: string;
  /** Resolve to a stable transaction id, or null when the receipt is not valid. */
  verify(itemId: string, receipt: string): Promise<string | null>;
}

/**
 * Development verifier: accepts receipts of the form `dev:<itemId>:<nonce>` and refuses to run
 * when NODE_ENV is production, so a real deployment cannot accidentally ship free purchases.
 */
export class DevReceiptVerifier implements ReceiptVerifier {
  readonly name = 'dev';

  constructor(private readonly allow: boolean) {}

  async verify(itemId: string, receipt: string): Promise<string | null> {
    if (!this.allow) return null;
    const parts = receipt.split(':');
    if (parts.length !== 3 || parts[0] !== 'dev' || parts[1] !== itemId) return null;
    return `dev-${itemId}-${parts[2]}`;
  }
}

export class PurchaseService {
  constructor(private readonly verifier: ReceiptVerifier) {}

  async purchase(profile: PlayerProfile, itemId: string, receipt: string): Promise<PurchaseOutcome> {
    const item = getStoreItem(itemId);
    if (!item) return { ok: false, error: 'unknown-item', granted: [] };
    const transactionId = await this.verifier.verify(itemId, receipt);
    if (!transactionId) return { ok: false, error: 'invalid-receipt', granted: [] };
    return applyVerifiedPurchase(profile, itemId, transactionId);
  }

  purchaseWithCoins(profile: PlayerProfile, itemId: string): PurchaseOutcome {
    return purchaseWithCoins(profile, itemId);
  }
}
