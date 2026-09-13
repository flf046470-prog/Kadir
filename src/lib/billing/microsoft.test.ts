import { describe, expect, it } from "vitest";
import { MicrosoftStoreVerifier, interpretRecurrence } from "./microsoft";
import { subscriptionFor } from "./purchase";

/**
 * The Microsoft Store driver.
 *
 * Two things are being tested, and they are different in kind. The first is the
 * protocol — two calls, in order, with the publisher's token on the second —
 * which is checked by recording what the driver sends. The second is the
 * reading of the answer, which is where money is actually at stake and which is
 * therefore tested case by case rather than through one happy path.
 *
 * The line the interface draws between "refused" and "unavailable" is the most
 * important behaviour here. `null` means the purchase is not valid and the
 * client must stop; a throw means the store could not be reached and the client
 * should try again. Confusing them either retries forever on a forged token or
 * hands out subscriptions whenever Microsoft has an outage.
 */

const PLUS = "com.fiorematch.app.plus.annual";
const VIP = "com.fiorematch.app.vip.annual";

const FUTURE = "2027-01-01T00:00:00.000Z";

type Call = { url: string; init: RequestInit };

/**
 * A fetch that answers the two endpoints and records what it was asked.
 *
 * `collections` is what the query returns; passing a number instead returns
 * that status, which is how the refusal-vs-outage cases are set up.
 */
function stubFetch(options: {
  collections?: unknown;
  collectionsStatus?: number;
  tokenStatus?: number;
  tokenBody?: unknown;
}) {
  const calls: Call[] = [];

  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });

    if (String(url).includes("/oauth2/token")) {
      const status = options.tokenStatus ?? 200;
      return new Response(
        JSON.stringify(options.tokenBody ?? { access_token: "publisher-token", expires_in: "3600" }),
        { status, headers: { "content-type": "application/json" } }
      );
    }

    const status = options.collectionsStatus ?? 200;
    return new Response(JSON.stringify(options.collections ?? { items: [] }), {
      status,
      headers: { "content-type": "application/json" }
    });
  }) as unknown as typeof fetch;

  return { impl, calls };
}

function verifier(fetchImpl: typeof fetch, productIds?: Record<string, string>) {
  return new MicrosoftStoreVerifier({
    tenantId: "tenant",
    clientId: "client",
    clientSecret: "secret",
    productIds,
    fetchImpl
  });
}

/** A collections item for a live subscription to `productId`. */
function item(productId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "collection-item-1",
    orderId: "order-99",
    productId,
    skuId: "0010",
    endDate: FUTURE,
    recurrenceState: "Active",
    ...overrides
  };
}

describe("what a recurrence state means for access", () => {
  it("keeps a live subscription live", () => {
    expect(interpretRecurrence("Active")).toEqual({ cancelled: false });
  });

  /**
   * Cancelling is not losing access. The member keeps what they paid for until
   * the period ends, which is `subscriptionFor`'s job — this only has to stop
   * the renewal being assumed.
   */
  it.each(["Canceled", "Cancelled", "Inactive"])("marks %s as not renewing", (state) => {
    expect(interpretRecurrence(state)).toEqual({ cancelled: true });
  });

  /**
   * A failed payment is the store retrying, not the member leaving. Marking it
   * cancelled would end the subscription on someone whose card was declined
   * once.
   */
  it("treats a failed renewal as still theirs", () => {
    expect(interpretRecurrence("Failed")).toEqual({ cancelled: false });
  });

  it("is case-insensitive, because the wire format is not ours", () => {
    expect(interpretRecurrence("ACTIVE")).toEqual({ cancelled: false });
  });

  /**
   * The case this function exists for.
   *
   * An unrecognised value means either Microsoft added a state or the field was
   * renamed. Guessing the closest branch is how a renamed field silently grants
   * subscriptions to everyone who asks.
   */
  it.each(["", undefined, "Suspended", "whatever"])("refuses %s rather than guessing", (state) => {
    expect(interpretRecurrence(state as string | undefined)).toBeNull();
  });
});

describe("the two-call protocol", () => {
  it("gets a publisher token first, then queries with it", async () => {
    const { impl, calls } = stubFetch({ collections: { items: [item(PLUS)] } });
    await verifier(impl).verify("store-id-key", PLUS);

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("/tenant/oauth2/token");
    expect(calls[1].url).toContain("/v6.0/collections/query");
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe(
      "Bearer publisher-token"
    );
  });

  it("asks Azure AD for a token the Store will accept", async () => {
    const { impl, calls } = stubFetch({ collections: { items: [item(PLUS)] } });
    await verifier(impl).verify("store-id-key", PLUS);

    const body = String(calls[0].init.body);
    expect(body).toContain("grant_type=client_credentials");
    // The wrong resource yields a token that authenticates and is then refused
    // by the Store, which is a confusing failure to debug.
    expect(body).toContain(encodeURIComponent("https://onestore.microsoft.com"));
  });

  /**
   * The Store ID key identifies the member, and `b2b` is the only identity type
   * that requires one. The alternatives let a server name a user directly,
   * which would make this endpoint a way to read anyone's entitlements.
   */
  it("names the member only by the key the client proved", async () => {
    const { impl, calls } = stubFetch({ collections: { items: [item(PLUS)] } });
    await verifier(impl).verify("store-id-key", PLUS);

    const body = JSON.parse(String(calls[1].init.body));
    expect(body.beneficiaries).toEqual([
      { identitytype: "b2b", identityValue: "store-id-key", localTicketReference: "" }
    ]);
  });

  /**
   * The token is the publisher's and identical for everyone, so fetching one
   * per verification is a round trip that proves nothing new.
   */
  it("reuses the publisher token across verifications", async () => {
    const { impl, calls } = stubFetch({ collections: { items: [item(PLUS)] } });
    const driver = verifier(impl);

    await driver.verify("key-1", PLUS);
    await driver.verify("key-2", PLUS);

    expect(calls.filter((call) => call.url.includes("/oauth2/token"))).toHaveLength(1);
    expect(calls.filter((call) => call.url.includes("/collections/query"))).toHaveLength(2);
  });
});

describe("reading the answer", () => {
  it("returns the subscription the member owns", async () => {
    const { impl } = stubFetch({ collections: { items: [item(PLUS)] } });
    const result = await verifier(impl).verify("key", PLUS);

    expect(result).toEqual({
      provider: "microsoft_store",
      providerRef: "collection-item-1",
      tier: "plus",
      expiresAt: new Date(FUTURE),
      cancelled: false,
      refunded: false
    });
  });

  /**
   * The collection item, not the order.
   *
   * A renewal is a new order against the same item. Keying on the order would
   * write a fresh subscription row every month and defeat the unique index that
   * stops one purchase entitling two accounts.
   */
  it("keys on the item, so a renewal is the same subscription", async () => {
    const { impl } = stubFetch({
      collections: { items: [item(PLUS, { orderId: "a-later-order" })] }
    });
    const result = await verifier(impl).verify("key", PLUS);

    expect(result?.providerRef).toBe("collection-item-1");
  });

  it("picks the product that was claimed out of everything owned", async () => {
    const { impl } = stubFetch({
      collections: { items: [item("com.fiorematch.app.something.else"), item(VIP)] }
    });
    const result = await verifier(impl).verify("key", VIP);

    expect(result?.tier).toBe("vip");
  });

  /**
   * Partner Center lets an add-on carry its own id, so a deployment whose ids
   * do not match ours maps them. Without this the driver authenticates
   * perfectly and finds nothing, which surfaces as "your purchase is invalid".
   */
  it("matches through the configured id map", async () => {
    const { impl } = stubFetch({ collections: { items: [item("9NBLGGH4R315")] } });
    const result = await verifier(impl, { [PLUS]: "9NBLGGH4R315" }).verify("key", PLUS);

    expect(result?.tier).toBe("plus");
  });

  it("refuses a product the member does not own", async () => {
    const { impl } = stubFetch({ collections: { items: [item(PLUS)] } });
    expect(await verifier(impl).verify("key", VIP)).toBeNull();
  });

  it("refuses an empty collection", async () => {
    const { impl } = stubFetch({ collections: { items: [] } });
    expect(await verifier(impl).verify("key", PLUS)).toBeNull();
  });

  it("refuses a product we do not sell, without asking the store to decide", async () => {
    const { impl } = stubFetch({ collections: { items: [item("com.someone.else.pro")] } });
    expect(await verifier(impl).verify("key", "com.someone.else.pro")).toBeNull();
  });

  it.each([
    ["a missing end date", { endDate: undefined }],
    ["an unparseable end date", { endDate: "not a date" }],
    ["no stable reference", { id: undefined, orderId: undefined }],
    ["a state it does not recognise", { recurrenceState: "Suspended" }]
  ])("refuses an item with %s", async (_label, overrides) => {
    const { impl } = stubFetch({ collections: { items: [item(PLUS, overrides)] } });
    expect(await verifier(impl).verify("key", PLUS)).toBeNull();
  });

  /**
   * Cancelled means "not renewing", and the row it produces still grants access
   * until the paid period ends. Asserted through `subscriptionFor` rather than
   * on the flag alone, because the flag is only interesting for what it does to
   * the subscription.
   */
  it("keeps a cancelled subscription until its period ends", async () => {
    const { impl } = stubFetch({
      collections: { items: [item(PLUS, { recurrenceState: "Canceled" })] }
    });
    const result = await verifier(impl).verify("key", PLUS);

    expect(result?.cancelled).toBe(true);
    expect(subscriptionFor(result!, new Date("2026-06-01")).status).toBe("canceled");
  });

  it("expires a subscription whose period has already ended", async () => {
    const { impl } = stubFetch({
      collections: { items: [item(PLUS, { endDate: "2025-01-01T00:00:00.000Z" })] }
    });
    const result = await verifier(impl).verify("key", PLUS);

    expect(subscriptionFor(result!, new Date("2026-06-01")).status).toBe("expired");
  });
});

describe("refused, versus could not be reached", () => {
  /**
   * The distinction the whole interface is built on. A rejected key is a
   * refusal the client must stop on; an outage is a retry.
   */
  it.each([400, 401, 403])("refuses a key the store rejects with %i", async (status) => {
    const { impl } = stubFetch({ collectionsStatus: status });
    expect(await verifier(impl).verify("forged", PLUS)).toBeNull();
  });

  it.each([429, 500, 503])("throws when the store answers %i", async (status) => {
    const { impl } = stubFetch({ collectionsStatus: status });
    await expect(verifier(impl).verify("key", PLUS)).rejects.toThrow(/collections responded/);
  });

  /**
   * Our credentials failing is a deployment fault, and must not be reported to
   * a member as "your purchase is invalid" — they would contact support about a
   * payment that went through perfectly.
   */
  it("throws when our own credentials are refused", async () => {
    const { impl } = stubFetch({ tokenStatus: 401 });
    await expect(verifier(impl).verify("key", PLUS)).rejects.toThrow(/Azure AD responded 401/);
  });

  it("throws when Azure AD answers without a token", async () => {
    const { impl } = stubFetch({ tokenBody: { expires_in: "3600" } });
    await expect(verifier(impl).verify("key", PLUS)).rejects.toThrow(/no access_token/);
  });
});
