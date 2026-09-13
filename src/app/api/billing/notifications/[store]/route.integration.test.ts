import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { setNotificationVerifier } from "@/lib/billing";
import type { NotificationVerifier, StoreNotification } from "@/lib/billing/notifications";
import type { StoreId } from "@/lib/billing/purchase";
import { recordPurchase } from "@/db/billing";
import { tierOf } from "@/db/entitlements";
import { createTestUser, resetDatabase } from "@/db/test-helpers";

/**
 * The one route in the application that writes without a session.
 *
 * Everything else is protected by `requireUser`; this is protected by a
 * signature and nothing else, which makes the refusals as much a part of the
 * behaviour as the happy path. Each of the four ways a notification can fail to
 * be believed is tested here, because getting any of them wrong is either free
 * subscriptions or silently dropped refunds.
 */

const now = new Date("2026-09-01T12:00:00Z");
const DAY = 86_400_000;

/** A driver that answers however a test needs it to, recording what it saw. */
class StubVerifier implements NotificationVerifier {
  readonly name = "stub";
  seen: { body: string; contentType: string | null } | null = null;

  constructor(
    private readonly answer: StoreNotification | null,
    private readonly unreachable = false
  ) {}

  async verify(body: string, headers: Headers): Promise<StoreNotification | null> {
    this.seen = { body, contentType: headers.get("content-type") };
    if (this.unreachable) throw new Error("could not reach the store");
    return this.answer;
  }
}

function notification(overrides: Partial<StoreNotification> = {}): StoreNotification {
  return {
    notificationId: "notif-1",
    signedAt: new Date(now.getTime() + DAY),
    purchase: {
      provider: "google_play",
      providerRef: "token-abc",
      tier: "plus",
      expiresAt: new Date(now.getTime() + 365 * DAY),
      cancelled: false,
      refunded: false
    },
    ...overrides
  };
}

function post(store: string, body = "{}") {
  const request = new NextRequest(`http://localhost/api/billing/notifications/${store}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  });
  return POST(request, { params: Promise.resolve({ store }) });
}

const STORES: StoreId[] = ["google_play", "app_store", "microsoft_store"];

function clearVerifiers() {
  for (const store of STORES) setNotificationVerifier(store, null);
}

beforeEach(async () => {
  await resetDatabase();
  clearVerifiers();
});

afterEach(() => {
  clearVerifiers();
  vi.restoreAllMocks();
});

describe("the store notification endpoint", () => {
  it("refuses a store it does not serve", async () => {
    const response = await post("paypal");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "unknown_store" });
  });

  /**
   * No driver is written for any store, so this is what the endpoint does
   * today. "Not open" rather than "accepted": an endpoint that returned 200
   * without checking anything would tell every store its notifications were
   * handled while none of them were.
   */
  it("says it is not open when no driver is configured", async () => {
    const response = await post("google_play");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ available: false, store: "google_play" });
  });

  it("wires one store without opening the others", async () => {
    setNotificationVerifier("google_play", new StubVerifier(notification()));

    expect((await post("app_store")).status).toBe(503);
    expect((await post("microsoft_store")).status).toBe(503);
  });

  /**
   * The signature covers the bytes that were sent. If this route parsed the
   * body and handed the driver a re-serialised object, key order and whitespace
   * would change and every real signature would fail — or, in a driver written
   * to be forgiving, none of them would.
   */
  it("hands the driver the raw body, unparsed", async () => {
    const verifier = new StubVerifier(null);
    setNotificationVerifier("google_play", verifier);
    const raw = '{ "b":2,  "a":1 }';

    await post("google_play", raw);

    expect(verifier.seen?.body).toBe(raw);
    expect(verifier.seen?.contentType).toBe("application/json");
  });

  it("refuses a notification the store did not sign", async () => {
    setNotificationVerifier("google_play", new StubVerifier(null));

    const response = await post("google_play");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_signature" });
  });

  /**
   * The distinction the whole interface is built around.
   *
   * A driver that could not reach the store has not caught a forgery — and
   * answering 400 would tell the store to stop retrying, so every notification
   * sent during an outage would be lost. Losing refunds that way is exactly the
   * failure this endpoint exists to prevent, so it must be a retryable 503.
   */
  it("asks the store to retry when the signature could not be checked", async () => {
    setNotificationVerifier("google_play", new StubVerifier(null, true));

    const response = await post("google_play");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "verification_unavailable" });
  });

  /**
   * A notification legitimately signed by one store, replayed at another
   * store's endpoint. Costs nothing to refuse now and matters the moment a
   * second driver exists.
   */
  it("refuses a notification whose store is not the one it was sent to", async () => {
    setNotificationVerifier("app_store", new StubVerifier(notification()));

    const response = await post("app_store");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "provider_mismatch" });
  });

  it("ends access on a signed refund", async () => {
    const user = await createTestUser();
    await recordPurchase(
      user,
      { ...notification().purchase, provider: "google_play" },
      now
    );
    expect(await tierOf(user, now)).toBe("plus");

    const refund = notification({
      purchase: { ...notification().purchase, refunded: true }
    });
    setNotificationVerifier("google_play", new StubVerifier(refund));

    const response = await post("google_play");

    expect(response.status).toBe(200);
    expect(await tierOf(user, now)).toBe("free");
  });

  /**
   * The reply is the same whatever happened, on purpose: a 200 here must not
   * let a caller who guessed a signature wrong learn whether their guess landed
   * on a real subscription.
   */
  it("answers the same way for a duplicate as for the first delivery", async () => {
    const user = await createTestUser();
    await recordPurchase(user, notification().purchase, now);
    setNotificationVerifier(
      "google_play",
      new StubVerifier(notification({ purchase: { ...notification().purchase, refunded: true } }))
    );

    const first = await post("google_play");
    const second = await post("google_play");

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await first.json()).toEqual({ ok: true });
    expect(await second.json()).toEqual({ ok: true });
  });

  it("accepts a notification about nobody here without saying so", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setNotificationVerifier("google_play", new StubVerifier(notification()));

    const response = await post("google_play");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
