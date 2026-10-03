/**
 * Store receipt verification.
 *
 * The rule this file exists to enforce: **the client never decides what it owns.** A receipt
 * arriving from a player is an unverified claim. It becomes an entitlement only after the
 * platform that took the money says so, over a channel the player cannot sit in the middle of.
 *
 * Each verifier therefore:
 *   - talks to the store's server-to-server API, never to anything the client supplied as a URL;
 *   - checks the returned SKU against the item actually being granted, so a receipt for a
 *     $0.99 item cannot be replayed against a $4.99 one;
 *   - returns a *stable* transaction id, which `applyVerifiedPurchase` uses to make granting
 *     idempotent — replaying the same receipt grants nothing the second time.
 *
 * Credentials come from the environment. None of them may ever reach the client bundle.
 */

import type { ReceiptVerifier } from './purchases.js';

/** Injected so verifiers can be tested without network access. */
export interface HttpClient {
  postForm(url: string, body: Record<string, string>): Promise<HttpResponse>;
  getJson(url: string, headers?: Record<string, string>): Promise<HttpResponse>;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

export const fetchHttpClient: HttpClient = {
  async postForm(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
    return { status: response.status, body: await safeJson(response) };
  },
  async getJson(url, headers) {
    const response = await fetch(url, { headers });
    return { status: response.status, body: await safeJson(response) };
  },
};

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Receipts are prefixed with the platform that issued them so one server can serve every store:
 *
 *   meta:<userId>          verified against the Horizon entitlement for this SKU
 *   steam:<orderId>        verified against ISteamMicroTxn
 *   play:<purchaseToken>   verified against Google Play androidpublisher
 *   dev:<itemId>:<nonce>   development only
 */
export function parseReceipt(receipt: string): { platform: string; payload: string } | null {
  const at = receipt.indexOf(':');
  if (at <= 0) return null;
  const platform = receipt.slice(0, at);
  const payload = receipt.slice(at + 1);
  if (!payload) return null;
  return { platform, payload };
}

/**
 * Meta Horizon Store.
 *
 * `verify_entitlement` answers whether this user owns the SKU; `consume_entitlement` burns a
 * consumable so it cannot be redeemed twice. Consuming is what makes the grant single-use at
 * the platform, and it is done *before* granting: if the consume fails we must not grant, or a
 * crash between the two leaves the player able to redeem again.
 */
export class MetaHorizonVerifier implements ReceiptVerifier {
  readonly name = 'meta';

  constructor(
    private readonly appId: string,
    appSecret: string,
    private readonly http: HttpClient = fetchHttpClient,
    /** Durable goods (an animal you keep) are verified but never consumed. */
    private readonly consumable = false,
  ) {
    this.accessToken = `OC|${appId}|${appSecret}`;
  }

  private readonly accessToken: string;

  async verify(itemId: string, receipt: string): Promise<string | null> {
    const parsed = parseReceipt(receipt);
    if (!parsed || parsed.platform !== 'meta') return null;
    const userId = parsed.payload;
    if (!/^[0-9]{1,32}$/.test(userId)) return null;

    const verified = await this.http.postForm(`https://graph.oculus.com/${this.appId}/verify_entitlement`, {
      access_token: this.accessToken,
      user_id: userId,
      sku: itemId,
    });
    if (verified.status !== 200 || record(verified.body)?.success !== true) return null;

    if (this.consumable) {
      const consumed = await this.http.postForm(`https://graph.oculus.com/${this.appId}/consume_entitlement`, {
        access_token: this.accessToken,
        user_id: userId,
        sku: itemId,
      });
      // Not consumed means not spent. Granting anyway would let the same purchase be redeemed
      // again on the next request.
      if (consumed.status !== 200 || record(consumed.body)?.success !== true) return null;
    }

    return `meta-${this.appId}-${userId}-${itemId}`;
  }
}

/**
 * Steam.
 *
 * `ISteamMicroTxn/QueryTxn` is the authority on whether an order was actually paid for. The
 * publisher Web API key it needs is only valid from a server Steam has allow-listed, which is
 * precisely why this cannot be done client-side.
 */
export class SteamMicroTxnVerifier implements ReceiptVerifier {
  readonly name = 'steam';

  constructor(
    private readonly appId: string,
    private readonly webApiKey: string,
    private readonly http: HttpClient = fetchHttpClient,
    private readonly host = 'https://partner.steam-api.com',
  ) {}

  async verify(itemId: string, receipt: string): Promise<string | null> {
    const parsed = parseReceipt(receipt);
    if (!parsed || parsed.platform !== 'steam') return null;
    const orderId = parsed.payload;
    if (!/^[0-9]{1,32}$/.test(orderId)) return null;

    const url =
      `${this.host}/ISteamMicroTxn/QueryTxn/v3/` +
      `?key=${encodeURIComponent(this.webApiKey)}&appid=${encodeURIComponent(this.appId)}&orderid=${encodeURIComponent(orderId)}`;
    const response = await this.http.getJson(url);
    if (response.status !== 200) return null;

    const params = record(record(response.body)?.response)?.params;
    const order = record(params);
    if (!order) return null;
    if (order.status !== 'Succeeded') return null;

    // The order must actually contain the item being granted — otherwise any paid order could
    // be replayed against the most expensive thing in the catalog.
    const items = Array.isArray(order.items) ? order.items : [];
    const matched = items.some((entry) => String(record(entry)?.itemid ?? '') === itemId);
    if (!matched) return null;

    return `steam-${this.appId}-${String(order.transid ?? orderId)}`;
  }
}

/**
 * Google Play.
 *
 * androidpublisher needs a short-lived OAuth token for a service account, so the caller
 * supplies a token provider rather than a static credential.
 */
export class GooglePlayVerifier implements ReceiptVerifier {
  readonly name = 'play';

  constructor(
    private readonly packageName: string,
    private readonly accessToken: () => Promise<string>,
    private readonly http: HttpClient = fetchHttpClient,
    private readonly host = 'https://androidpublisher.googleapis.com',
  ) {}

  async verify(itemId: string, receipt: string): Promise<string | null> {
    const parsed = parseReceipt(receipt);
    if (!parsed || parsed.platform !== 'play') return null;
    const token = parsed.payload;
    if (!/^[\w.-]{1,512}$/.test(token)) return null;

    const url =
      `${this.host}/androidpublisher/v3/applications/${encodeURIComponent(this.packageName)}` +
      `/purchases/products/${encodeURIComponent(itemId)}/tokens/${encodeURIComponent(token)}`;
    const response = await this.http.getJson(url, { authorization: `Bearer ${await this.accessToken()}` });
    if (response.status !== 200) return null;

    const body = record(response.body);
    if (!body) return null;
    // 0 = purchased. 1 = cancelled, 2 = pending — neither is an entitlement.
    if (body.purchaseState !== 0) return null;
    const orderId = typeof body.orderId === 'string' ? body.orderId : null;
    if (!orderId) return null;

    return `play-${this.packageName}-${orderId}`;
  }
}

/**
 * Routes a receipt to the verifier for the store that issued it.
 *
 * An unknown prefix is a refusal, not a fallback: silently accepting a receipt no configured
 * store vouched for is the whole failure mode this file exists to prevent.
 */
export class PlatformReceiptVerifier implements ReceiptVerifier {
  readonly name = 'platform';

  constructor(private readonly verifiers: Map<string, ReceiptVerifier>) {}

  get platforms(): string[] {
    return [...this.verifiers.keys()].sort();
  }

  async verify(itemId: string, receipt: string): Promise<string | null> {
    const parsed = parseReceipt(receipt);
    if (!parsed) return null;
    const verifier = this.verifiers.get(parsed.platform);
    if (!verifier) return null;
    return verifier.verify(itemId, receipt);
  }
}

export interface StoreCredentials {
  metaAppId?: string;
  metaAppSecret?: string;
  steamAppId?: string;
  steamWebApiKey?: string;
  playPackageName?: string;
  /** Supplied by the deployment; androidpublisher needs a short-lived service-account token. */
  playAccessToken?: () => Promise<string>;
}

/**
 * Build the verifier from whatever credentials the deployment actually has.
 *
 * A store with no credentials configured is simply absent from the routing table, so its
 * receipts are refused rather than accepted unverified. `allowDev` is gated on NODE_ENV by the
 * caller: a production build must never accept a `dev:` receipt, because that is a free
 * purchase for anyone who reads this file.
 */
export function createReceiptVerifier(
  credentials: StoreCredentials,
  devVerifier: ReceiptVerifier | null,
  http: HttpClient = fetchHttpClient,
): PlatformReceiptVerifier {
  const verifiers = new Map<string, ReceiptVerifier>();

  if (credentials.metaAppId && credentials.metaAppSecret) {
    verifiers.set('meta', new MetaHorizonVerifier(credentials.metaAppId, credentials.metaAppSecret, http));
  }
  if (credentials.steamAppId && credentials.steamWebApiKey) {
    verifiers.set('steam', new SteamMicroTxnVerifier(credentials.steamAppId, credentials.steamWebApiKey, http));
  }
  if (credentials.playPackageName && credentials.playAccessToken) {
    verifiers.set('play', new GooglePlayVerifier(credentials.playPackageName, credentials.playAccessToken, http));
  }
  if (devVerifier) verifiers.set('dev', devVerifier);

  return new PlatformReceiptVerifier(verifiers);
}
