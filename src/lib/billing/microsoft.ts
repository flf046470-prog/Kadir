import { tierForProduct, type PurchaseVerifier, type VerifiedPurchase } from "./purchase";

/**
 * The Microsoft Store, over the Store collections API.
 *
 * Two calls rather than one, and the shape is worth stating because it is not
 * the shape the other two stores use:
 *
 *  1. **We** authenticate to Azure AD with a client credential and ask for a
 *     token whose audience is the Store service. This proves the *publisher*.
 *  2. That token, plus a **Store ID key** the client obtained from Windows,
 *     queries what the member owns. The Store ID key proves the *member*.
 *
 * Neither half is sufficient alone, which is the point: the client cannot mint
 * a publisher token, and the server has no way to name a member without one the
 * client fetched from Windows.
 *
 * The Store ID key is short-lived and single-purpose. It is what arrives as
 * `token` here, and it plays the role Google's purchase token and Apple's
 * original transaction id play in the other drivers — with the difference that
 * it identifies the *person*, not the purchase, so the query comes back with
 * everything they own and the product has to be picked out of it.
 *
 * ---
 *
 * **Verify the field names below against Microsoft's current documentation
 * before taking money with this.** The two endpoints and the two-step flow are
 * stable and long-standing; the exact spelling of the response fields —
 * `recurrenceState` in particular — is the part most likely to have moved, and
 * a wrong name here fails closed (every purchase refused) rather than open.
 * `interpret()` is deliberately the only place that reads them.
 */

const LOGIN_HOST = "https://login.microsoftonline.com";
const COLLECTIONS_HOST = "https://collections.mp.microsoft.com";

/** The audience the Store service accepts. Not a URL that is ever fetched. */
const STORE_RESOURCE = "https://onestore.microsoft.com";

export type MicrosoftStoreOptions = {
  /** Azure AD tenant the publisher account lives in. */
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /**
   * Our product ids → the ids the Store returns, when they differ.
   *
   * Partner Center lets an add-on carry a product id of your choosing, so a
   * deployment that named them to match `PRODUCT_TIERS` needs nothing here.
   * One that did not — or that has to match on the Store's own id — maps them,
   * because the alternative is a driver that authenticates perfectly and then
   * finds no matching item, which reads as "the purchase is invalid".
   */
  productIds?: Record<string, string>;
  loginHost?: string;
  collectionsHost?: string;
  fetchImpl?: typeof fetch;
};

/** One entry of the collections response, as much of it as is read. */
type CollectionItem = {
  productId?: string;
  id?: string;
  orderId?: string;
  skuId?: string;
  endDate?: string;
  recurrenceState?: string;
};

/**
 * What a `recurrenceState` means for access.
 *
 * Exported and tested on its own because it is the piece most likely to need
 * correcting against Microsoft's documentation, and the piece where being
 * wrong costs the most in either direction — one way gives the product away,
 * the other cuts off someone who paid.
 *
 * `null` means "this is not a subscription we should honour at all".
 */
export function interpretRecurrence(
  state: string | undefined
): { cancelled: boolean } | null {
  switch ((state ?? "").toLowerCase()) {
    case "active":
      return { cancelled: false };

    /**
     * Cancelled, and inactive, both keep the paid period.
     *
     * `Canceled` is auto-renew switched off; `Inactive` is a subscription that
     * has stopped renewing. Neither is a refund, so neither ends access on its
     * own — `endDate` does, and `subscriptionFor` already treats that date as
     * authoritative. Marking them cancelled is what stops the next renewal
     * from being assumed.
     */
    case "canceled":
    case "cancelled":
    case "inactive":
      return { cancelled: true };

    /**
     * A failed renewal payment is not a cancellation.
     *
     * The member has not asked to stop and the store is still retrying. Access
     * continues until `endDate`, which is the same thing `past_due` means in
     * the subscriptions table.
     */
    case "failed":
      return { cancelled: false };

    /**
     * Anything else is refused rather than guessed at.
     *
     * A state this does not recognise is either a value Microsoft added or a
     * field that has been renamed. Both are reasons to refuse a purchase and
     * look, not to pick whichever branch is closest.
     */
    default:
      return null;
  }
}

export class MicrosoftStoreVerifier implements PurchaseVerifier {
  readonly name = "microsoft_store";

  private readonly options: Required<
    Pick<MicrosoftStoreOptions, "tenantId" | "clientId" | "clientSecret">
  > &
    MicrosoftStoreOptions;
  private readonly fetchImpl: typeof fetch;

  /**
   * The publisher token, held until shortly before it expires.
   *
   * It lasts about an hour and is identical for every member, so fetching one
   * per verification would be a second round trip on every call for no
   * additional proof of anything.
   */
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(options: MicrosoftStoreOptions) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private get loginHost(): string {
    return this.options.loginHost ?? LOGIN_HOST;
  }

  private get collectionsHost(): string {
    return this.options.collectionsHost ?? COLLECTIONS_HOST;
  }

  /** The publisher's Azure AD token, cached. */
  private async accessToken(now: number = Date.now()): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > now) return this.cachedToken.value;

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      resource: STORE_RESOURCE
    });

    const response = await this.fetchImpl(
      `${this.loginHost}/${this.options.tenantId}/oauth2/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      }
    );

    if (!response.ok) {
      // Our own credentials, not the member's. This is a deployment fault and
      // has to surface as one — it is not a reason to tell someone their
      // purchase was invalid.
      throw new Error(`Azure AD responded ${response.status} for the Store token`);
    }

    const payload = (await response.json()) as { access_token?: string; expires_in?: string };
    if (!payload.access_token) throw new Error("Azure AD returned no access_token");

    /**
     * Expire the cache a minute early.
     *
     * A token that is valid when checked and expired when it arrives is a
     * 401 on a purchase the member is watching, and the whole margin costs is
     * one extra token request an hour.
     */
    const lifetime = Number(payload.expires_in ?? 3600);
    this.cachedToken = {
      value: payload.access_token,
      expiresAt: now + Math.max(lifetime - 60, 0) * 1000
    };

    return payload.access_token;
  }

  async verify(token: string, productId: string): Promise<VerifiedPurchase | null> {
    const accessToken = await this.accessToken();

    const response = await this.fetchImpl(`${this.collectionsHost}/v6.0/collections/query`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        maxPageSize: 100,
        /**
         * `b2b` with the Store ID key is the server-to-server form.
         *
         * The other identity types name a user directly, which is exactly what
         * a server must not be able to do — it would let this endpoint read any
         * member's entitlements without them having proved anything.
         */
        beneficiaries: [
          { identitytype: "b2b", identityValue: token, localTicketReference: "" }
        ]
      })
    });

    /**
     * A rejected Store ID key is a refusal; anything else is an outage.
     *
     * The interface draws this line deliberately — `null` means "not a valid
     * purchase" and a throw means "ask again later" — and collapsing them
     * would either retry forever on a forged token or hand out entitlements
     * whenever the Store has a bad afternoon.
     */
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Store collections responded ${response.status}`);
    }

    const payload = (await response.json()) as { items?: CollectionItem[] };
    return this.interpret(payload.items ?? [], productId);
  }

  /**
   * The one place the response shape is read.
   *
   * Kept separate from the two HTTP calls so that correcting a field name is a
   * change to a pure function with tests around it, rather than surgery on a
   * method that also does authentication.
   */
  private interpret(items: CollectionItem[], productId: string): VerifiedPurchase | null {
    // Refused rather than defaulted, for the reason `tierForProduct` gives:
    // guessing a tier for an unrecognised product bills for one and grants the
    // other.
    const tier = tierForProduct(productId);
    if (!tier) return null;

    const storeProductId = this.options.productIds?.[productId] ?? productId;

    const item = items.find(
      (candidate) =>
        candidate.productId === storeProductId || candidate.productId === productId
    );

    // The member does not own it. Not an error — this is the answer to "did
    // they pay for this?", and it is no.
    if (!item) return null;

    const recurrence = interpretRecurrence(item.recurrenceState);
    if (!recurrence) return null;

    if (!item.endDate) return null;
    const expiresAt = new Date(item.endDate);
    if (Number.isNaN(expiresAt.getTime())) return null;

    /**
     * The collection item id, not the order id.
     *
     * `providerRef` has to be stable across renewals — see its note in
     * `purchase.ts` — and a renewal is a new order against the same collection
     * item. Keying on the order would write a new subscription row every month
     * and lose the unique-index protection that stops one purchase entitling
     * two accounts.
     */
    const providerRef = item.id ?? item.orderId;
    if (!providerRef) return null;

    return {
      provider: this.name,
      providerRef,
      tier,
      expiresAt,
      cancelled: recurrence.cancelled,
      /**
       * The collections API does not report a refund.
       *
       * A revoked entitlement leaves the collection, so a refunded purchase
       * arrives here as "not owned" and is refused by the `!item` branch above
       * — which produces the same loss of access, by a different route. The
       * flag stays false rather than guessed at; Microsoft's clawback feed is
       * the thing that would set it, and nothing consumes that yet.
       */
      refunded: false
    };
  }
}
