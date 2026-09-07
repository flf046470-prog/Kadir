import { describe, expect, it } from 'vitest';

import {
  GooglePlayVerifier,
  MetaHorizonVerifier,
  PlatformReceiptVerifier,
  SteamMicroTxnVerifier,
  createReceiptVerifier,
  parseReceipt,
} from './receipts.js';
import type { HttpClient, HttpResponse } from './receipts.js';
import { DevReceiptVerifier } from './purchases.js';

interface Call {
  url: string;
  body?: Record<string, string>;
  headers?: Record<string, string>;
}

/** Records every request so tests can assert what was sent, not just what came back. */
function stubHttp(handler: (call: Call) => HttpResponse): { http: HttpClient; calls: Call[] } {
  const calls: Call[] = [];
  const http: HttpClient = {
    async postForm(url, body) {
      const call = { url, body };
      calls.push(call);
      return handler(call);
    },
    async getJson(url, headers) {
      const call = { url, headers };
      calls.push(call);
      return handler(call);
    },
  };
  return { http, calls };
}

const ok = (body: unknown): HttpResponse => ({ status: 200, body });

describe('receipt parsing', () => {
  it('splits on the first colon so payloads may contain colons', () => {
    expect(parseReceipt('dev:wolf:abc')).toEqual({ platform: 'dev', payload: 'wolf:abc' });
    expect(parseReceipt('meta:12345')).toEqual({ platform: 'meta', payload: '12345' });
  });

  it('rejects malformed receipts', () => {
    expect(parseReceipt('nocolon')).toBeNull();
    expect(parseReceipt(':leading')).toBeNull();
    expect(parseReceipt('meta:')).toBeNull();
    expect(parseReceipt('')).toBeNull();
  });
});

describe('Meta Horizon verifier', () => {
  it('verifies the entitlement for the item actually being granted', async () => {
    const { http, calls } = stubHttp(() => ok({ success: true }));
    const verifier = new MetaHorizonVerifier('app1', 'secret1', http);

    const id = await verifier.verify('wolf', 'meta:98765');

    expect(id).toBe('meta-app1-98765-wolf');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://graph.oculus.com/app1/verify_entitlement');
    // The SKU sent is the item the server is about to grant, never anything the client chose.
    expect(calls[0]?.body).toEqual({ access_token: 'OC|app1|secret1', user_id: '98765', sku: 'wolf' });
  });

  it('refuses when Meta says the user does not own the SKU', async () => {
    const { http } = stubHttp(() => ok({ success: false }));
    expect(await new MetaHorizonVerifier('app1', 's', http).verify('wolf', 'meta:98765')).toBeNull();
  });

  it('refuses on a non-200, rather than treating an outage as ownership', async () => {
    const { http } = stubHttp(() => ({ status: 500, body: null }));
    expect(await new MetaHorizonVerifier('app1', 's', http).verify('wolf', 'meta:1')).toBeNull();
  });

  it('consumes a consumable before granting, and refuses if the consume fails', async () => {
    const { http, calls } = stubHttp((call) =>
      call.url.endsWith('/consume_entitlement') ? ok({ success: false }) : ok({ success: true }),
    );
    const verifier = new MetaHorizonVerifier('app1', 's', http, true);

    // A failed consume means the purchase was not spent; granting anyway would let the same
    // receipt be redeemed again on the next request.
    expect(await verifier.verify('coins_100', 'meta:5')).toBeNull();
    expect(calls.map((c) => c.url)).toEqual([
      'https://graph.oculus.com/app1/verify_entitlement',
      'https://graph.oculus.com/app1/consume_entitlement',
    ]);
  });

  it('grants a consumable once the consume succeeds', async () => {
    const { http } = stubHttp(() => ok({ success: true }));
    expect(await new MetaHorizonVerifier('app1', 's', http, true).verify('coins_100', 'meta:5')).toBe('meta-app1-5-coins_100');
  });

  it('rejects a user id that is not a plain number', async () => {
    const { http, calls } = stubHttp(() => ok({ success: true }));
    expect(await new MetaHorizonVerifier('app1', 's', http).verify('wolf', 'meta:../../evil')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('Steam verifier', () => {
  const succeeded = (itemId: string, transid = 'T99') =>
    ok({ response: { params: { status: 'Succeeded', transid, items: [{ itemid: itemId }] } } });

  it('accepts a succeeded order containing the item', async () => {
    const { http, calls } = stubHttp(() => succeeded('tiger'));
    const id = await new SteamMicroTxnVerifier('440', 'KEY', http).verify('tiger', 'steam:1234');

    expect(id).toBe('steam-440-T99');
    expect(calls[0]?.url).toContain('/ISteamMicroTxn/QueryTxn/v3/');
    expect(calls[0]?.url).toContain('orderid=1234');
  });

  it('refuses an order that does not contain the item being granted', async () => {
    // Otherwise any cheap paid order could be replayed against the most expensive item.
    const { http } = stubHttp(() => succeeded('frog'));
    expect(await new SteamMicroTxnVerifier('440', 'KEY', http).verify('dragon', 'steam:1234')).toBeNull();
  });

  it('refuses an order that has not succeeded', async () => {
    const { http } = stubHttp(() => ok({ response: { params: { status: 'Failed', items: [{ itemid: 'tiger' }] } } }));
    expect(await new SteamMicroTxnVerifier('440', 'KEY', http).verify('tiger', 'steam:1234')).toBeNull();
  });

  it('refuses a malformed response instead of throwing', async () => {
    const { http } = stubHttp(() => ok({ nope: true }));
    expect(await new SteamMicroTxnVerifier('440', 'KEY', http).verify('tiger', 'steam:1234')).toBeNull();
  });

  it('rejects a non-numeric order id without calling out', async () => {
    const { http, calls } = stubHttp(() => succeeded('tiger'));
    expect(await new SteamMicroTxnVerifier('440', 'KEY', http).verify('tiger', 'steam:abc')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('Google Play verifier', () => {
  it('accepts a purchased token and sends the bearer credential', async () => {
    const { http, calls } = stubHttp(() => ok({ purchaseState: 0, orderId: 'GPA.1' }));
    const verifier = new GooglePlayVerifier('net.example.kc', async () => 'TOKEN', http);

    expect(await verifier.verify('panda', 'play:abc.def-123')).toBe('play-net.example.kc-GPA.1');
    expect(calls[0]?.headers?.authorization).toBe('Bearer TOKEN');
    expect(calls[0]?.url).toContain('/purchases/products/panda/tokens/abc.def-123');
  });

  it('refuses a cancelled or pending purchase', async () => {
    for (const purchaseState of [1, 2]) {
      const { http } = stubHttp(() => ok({ purchaseState, orderId: 'GPA.1' }));
      const verifier = new GooglePlayVerifier('p', async () => 'T', http);
      expect(await verifier.verify('panda', 'play:tok')).toBeNull();
    }
  });
});

describe('platform routing', () => {
  it('routes each receipt to the verifier for its store', async () => {
    const { http } = stubHttp((call) =>
      call.url.includes('graph.oculus.com')
        ? ok({ success: true })
        : ok({ response: { params: { status: 'Succeeded', transid: 'T1', items: [{ itemid: 'wolf' }] } } }),
    );
    const verifier = createReceiptVerifier(
      { metaAppId: 'a', metaAppSecret: 'b', steamAppId: '440', steamWebApiKey: 'k' },
      null,
      http,
    );

    expect(verifier.platforms).toEqual(['meta', 'steam']);
    expect(await verifier.verify('wolf', 'meta:1')).toMatch(/^meta-/);
    expect(await verifier.verify('wolf', 'steam:2')).toMatch(/^steam-/);
  });

  it('refuses a receipt from a store with no credentials configured', async () => {
    const { http, calls } = stubHttp(() => ok({ success: true }));
    const verifier = createReceiptVerifier({ metaAppId: 'a', metaAppSecret: 'b' }, null, http);

    // Silently accepting a receipt no configured store vouched for is the failure this prevents.
    expect(await verifier.verify('wolf', 'steam:2')).toBeNull();
    expect(await verifier.verify('wolf', 'play:tok')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('omits the dev verifier when it is not passed, so production cannot grant free purchases', async () => {
    const { http } = stubHttp(() => ok({ success: true }));
    const production = createReceiptVerifier({ metaAppId: 'a', metaAppSecret: 'b' }, null, http);
    expect(production.platforms).not.toContain('dev');
    expect(await production.verify('wolf', 'dev:wolf:nonce')).toBeNull();

    const development = createReceiptVerifier({}, new DevReceiptVerifier(true), http);
    expect(await development.verify('wolf', 'dev:wolf:nonce')).toBe('dev-wolf-nonce');
  });

  it('refuses an unknown platform prefix rather than falling back', async () => {
    const verifier = new PlatformReceiptVerifier(new Map());
    expect(await verifier.verify('wolf', 'itch:123')).toBeNull();
    expect(await verifier.verify('wolf', 'garbage')).toBeNull();
  });
});
