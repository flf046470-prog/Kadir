import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@kc/net';
import { chooseServer, fallbackNotice, onlineOriginOf, probeServer, socketUrlFor } from './servers.js';

const PAGE = 'http://127.0.0.1:21787';
const HOSTED = 'https://play.kangaroo.example';

/** A document holding one meta tag, the way the bundled server writes it. */
function docWith(content: string | null): Pick<Document, 'querySelector'> {
  return {
    querySelector: (selector: string) =>
      content !== null && selector === 'meta[name="kc-online-origin"]' ? ({ getAttribute: () => content } as unknown as Element) : null,
  };
}

/** A `fetch` that answers `/api/health` as a server on `protocol` would, or fails. */
function health(answer: { protocol?: number; status?: number } | 'down' | 'hang'): typeof fetch {
  return ((_url: string, init?: RequestInit) => {
    if (answer === 'down') return Promise.reject(new TypeError('Failed to fetch'));
    if (answer === 'hang') {
      return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true, protocol: answer.protocol }), { status: answer.status ?? 200 }));
  }) as typeof fetch;
}

describe('finding the hosted server', () => {
  it('reads the origin the bundled server wrote, and nothing else', () => {
    expect(onlineOriginOf(docWith(null))).toBeNull();
    expect(onlineOriginOf(docWith(`${HOSTED}/whatever`))).toBe(HOSTED);
    expect(onlineOriginOf(docWith('not a url'))).toBeNull();
    expect(onlineOriginOf(docWith('javascript:alert(1)'))).toBeNull();
  });

  it('plays on the hosted server when it answers in this build’s protocol', async () => {
    const choice = await chooseServer(PAGE, HOSTED, (origin) => probeServer(origin, health({ protocol: PROTOCOL_VERSION })));
    expect(choice).toEqual({ origin: HOSTED, fallback: null });
  });

  it('falls back to the server it carries when the hosted one is down, hangs or speaks another protocol', async () => {
    expect(await chooseServer(PAGE, HOSTED, (o) => probeServer(o, health('down')))).toEqual({ origin: PAGE, fallback: 'unreachable' });
    expect(await chooseServer(PAGE, HOSTED, (o) => probeServer(o, health({ status: 502 })))).toEqual({ origin: PAGE, fallback: 'unreachable' });
    expect(await chooseServer(PAGE, HOSTED, (o) => probeServer(o, health('hang'), 20))).toEqual({ origin: PAGE, fallback: 'unreachable' });
    // An older hosted server, or a newer one: either would refuse this build at `hello`.
    expect(await chooseServer(PAGE, HOSTED, (o) => probeServer(o, health({ protocol: PROTOCOL_VERSION + 1 })))).toEqual({ origin: PAGE, fallback: 'mismatch' });
    expect(await chooseServer(PAGE, HOSTED, (o) => probeServer(o, health({})))).toEqual({ origin: PAGE, fallback: 'mismatch' });
  });

  it('asks nobody when no hosted server was named — the browser build pays nothing for this', async () => {
    let asked = 0;
    const probe = async () => {
      asked++;
      return 'ok' as const;
    };
    expect(await chooseServer(HOSTED, null, probe)).toEqual({ origin: HOSTED, fallback: null });
    expect(await chooseServer(HOSTED, HOSTED, probe)).toEqual({ origin: HOSTED, fallback: null });
    expect(asked).toBe(0);
  });

  it('opens the socket on the chosen server, secure when the page of that server is', () => {
    expect(socketUrlFor(HOSTED)).toBe('wss://play.kangaroo.example/ws');
    expect(socketUrlFor(PAGE)).toBe('ws://127.0.0.1:21787/ws');
  });

  it('tells the player which of the two things went wrong', () => {
    expect(fallbackNotice('unreachable')).toMatch(/could not be reached/);
    expect(fallbackNotice('mismatch')).toMatch(/update/);
    for (const reason of ['unreachable', 'mismatch'] as const) expect(fallbackNotice(reason)).toMatch(/nobody else can join/);
  });
});
