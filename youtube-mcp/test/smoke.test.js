/**
 * Offline verification of everything that does not need Google or the network:
 * discovery documents, dynamic client registration, the authorization redirect,
 * PKCE enforcement, the token endpoint, and the MCP handshake + lazy-auth gate.
 *
 * Run with:  node test/smoke.test.js
 */

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.PUBLIC_BASE_URL = BASE;
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret-never-real';
process.env.TOKEN_SECRET = 'test-token-secret-at-least-32-characters-long-xxxxx';

const { default: handler } = await import('../api/index.js');
const { seal } = await import('../lib/crypto.js');

const server = createServer((req, res) => {
  handler(req, res).catch((err) => {
    res.statusCode = 500;
    res.end(String(err?.stack || err));
  });
});
await new Promise((r) => server.listen(PORT, r));

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

const rpc = (body, headers = {}) =>
  fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });

console.log('\nScareWithin YouTube MCP — offline smoke tests\n');

/* ---------------------------- health ---------------------------- */

await test('GET /health reports a fully configured server', async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.configured, true);
  assert.deepEqual(body.missing_env, []);
  assert.equal(body.mcp_endpoint, `${BASE}/mcp`);
  assert.equal(body.google_redirect_uri, `${BASE}/oauth/google/callback`);
  // A health check must never expose secret values.
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes('test-client-secret-never-real'), 'health leaked the client secret');
  assert.ok(!raw.includes('test-token-secret'), 'health leaked the token secret');
});

/* ------------------------ discovery documents ------------------------ */

await test('RFC 9728 protected resource metadata is served on both paths', async () => {
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const res = await fetch(BASE + path);
    assert.equal(res.status, 200, `${path} returned ${res.status}`);
    const body = await res.json();
    assert.equal(body.resource, `${BASE}/mcp`, 'resource must equal the MCP URL exactly');
    assert.deepEqual(body.authorization_servers, [BASE]);
    assert.ok(Array.isArray(body.scopes_supported) && body.scopes_supported.length);
  }
});

await test('RFC 8414 authorization server metadata advertises what Claude requires', async () => {
  const res = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
  assert.equal(res.status, 200);
  const m = await res.json();
  assert.equal(m.issuer, BASE);
  assert.equal(m.authorization_endpoint, `${BASE}/oauth/authorize`);
  assert.equal(m.token_endpoint, `${BASE}/oauth/token`);
  assert.equal(m.registration_endpoint, `${BASE}/oauth/register`, 'DCR endpoint is required by Claude');
  assert.deepEqual(m.code_challenge_methods_supported, ['S256'], 'Claude always sends S256 PKCE');
  assert.ok(m.token_endpoint_auth_methods_supported.includes('none'), 'Claude registers as a public client');
  assert.ok(m.grant_types_supported.includes('refresh_token'));
  assert.equal(m.authorization_response_iss_parameter_supported, true);
});

/* ------------------ dynamic client registration ------------------ */

let clientId;
await test('POST /oauth/register issues a client for the Claude callback URL', async () => {
  const res = await fetch(`${BASE}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none',
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.ok(body.client_id, 'no client_id returned');
  assert.equal(body.token_endpoint_auth_method, 'none');
  clientId = body.client_id;
});

await test('POST /oauth/register rejects a plaintext http redirect URI', async () => {
  const res = await fetch(`${BASE}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: ['http://evil.example.com/cb'] }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_redirect_uri');
});

/* ------------------------ authorize endpoint ------------------------ */

const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

await test('GET /oauth/authorize redirects to Google with the right parameters', async () => {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'claude-state-123',
    scope: 'youtube.read youtube.manage youtube.upload analytics.read',
    resource: `${BASE}/mcp`,
  });
  const res = await fetch(`${BASE}/oauth/authorize?${q}`, { redirect: 'manual' });
  assert.equal(res.status, 302);

  const loc = new URL(res.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(loc.searchParams.get('client_id'), process.env.GOOGLE_CLIENT_ID);
  assert.equal(loc.searchParams.get('redirect_uri'), `${BASE}/oauth/google/callback`);
  assert.equal(loc.searchParams.get('access_type'), 'offline', 'needed for a refresh token');
  assert.equal(loc.searchParams.get('prompt'), 'consent', 'needed to guarantee a refresh token');

  const googleScopes = loc.searchParams.get('scope').split(' ');
  assert.ok(googleScopes.includes('https://www.googleapis.com/auth/youtube.force-ssl'));
  assert.ok(googleScopes.includes('https://www.googleapis.com/auth/youtube.upload'));
  assert.ok(googleScopes.includes('https://www.googleapis.com/auth/yt-analytics.readonly'));
  assert.ok(
    !googleScopes.includes('https://www.googleapis.com/auth/yt-analytics-monetary.readonly'),
    'revenue scope must stay opt-in for least privilege',
  );
  assert.ok(
    !googleScopes.includes('https://www.googleapis.com/auth/youtube.readonly'),
    'readonly is redundant when force-ssl is granted',
  );

  // Claude's own state must not leak to Google in the clear.
  assert.ok(!loc.searchParams.get('state').includes('claude-state-123'));
});

await test('GET /oauth/authorize refuses an unregistered redirect_uri', async () => {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: 'https://attacker.example.com/steal',
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const res = await fetch(`${BASE}/oauth/authorize?${q}`, { redirect: 'manual' });
  assert.equal(res.status, 400, 'must not redirect to an unregistered URI');
  assert.ok(!res.headers.get('location'));
});

await test('GET /oauth/authorize requires S256 PKCE', async () => {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'plain',
  });
  const res = await fetch(`${BASE}/oauth/authorize?${q}`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location'));
  assert.equal(loc.origin, 'https://claude.ai');
  assert.equal(loc.searchParams.get('error'), 'invalid_request');
  assert.equal(loc.searchParams.get('iss'), BASE, 'RFC 9207 iss is required on error responses too');
});

/* -------------------------- token endpoint -------------------------- */

// Mint the code the Google callback would have produced, so the token
// endpoint can be exercised without contacting Google.
function mintCode(overrides = {}) {
  return seal(
    'code',
    {
      rt: 'fake-google-refresh-token',
      at: 'fake-google-access-token',
      ax: Math.floor(Date.now() / 1000) + 3000,
      cc: challenge,
      ru: REDIRECT,
      ci: clientId,
      sc: ['youtube.read', 'youtube.manage', 'analytics.read'],
      aud: `${BASE}/mcp`,
      ...overrides,
    },
    600,
  );
}

const form = (obj) =>
  fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(obj),
  });

let accessToken;
await test('POST /oauth/token exchanges a code for tokens (form-urlencoded)', async () => {
  const res = await form({
    grant_type: 'authorization_code',
    code: mintCode(),
    redirect_uri: REDIRECT,
    client_id: clientId,
    code_verifier: verifier,
  });
  assert.equal(res.status, 200, `token endpoint returned ${res.status}`);
  const body = await res.json();
  assert.equal(body.token_type, 'Bearer');
  assert.ok(body.access_token, 'no access_token');
  assert.ok(body.refresh_token, 'no refresh_token — Claude needs one to stay connected');
  assert.equal(body.expires_in, 3600);
  assert.equal(body.scope, 'youtube.read youtube.manage analytics.read');
  // The Google refresh token must never appear in what Claude receives.
  assert.ok(!JSON.stringify(body).includes('fake-google-refresh-token'), 'Google refresh token leaked to the client');
  accessToken = body.access_token;
});

await test('POST /oauth/token rejects a wrong PKCE verifier', async () => {
  const res = await form({
    grant_type: 'authorization_code',
    code: mintCode(),
    redirect_uri: REDIRECT,
    client_id: clientId,
    code_verifier: randomBytes(48).toString('base64url'),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_grant');
});

await test('POST /oauth/token rejects a tampered authorization code', async () => {
  const good = mintCode();
  const bad = good.slice(0, -4) + 'AAAA';
  const res = await form({ grant_type: 'authorization_code', code: bad, redirect_uri: REDIRECT, code_verifier: verifier });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_grant');
});

await test('POST /oauth/token rejects a refresh token replayed as an authorization code', async () => {
  const rt = seal('rt', { rt: 'x', sc: [], aud: `${BASE}/mcp` }, 600);
  const res = await form({ grant_type: 'authorization_code', code: rt, redirect_uri: REDIRECT, code_verifier: verifier });
  assert.equal(res.status, 400, 'type confusion between token kinds must be impossible');
  assert.equal((await res.json()).error, 'invalid_grant');
});

await test('GET /oauth/token returns 405, not a crash', async () => {
  const res = await fetch(`${BASE}/oauth/token`);
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST, OPTIONS');
});

/* ------------------------- MCP handshake ------------------------- */

await test('MCP initialize succeeds without a token', async () => {
  const res = await rpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.result.protocolVersion, '2025-06-18', 'must echo a protocol version the client asked for');
  assert.ok(body.result.capabilities.tools);
  assert.equal(body.result.serverInfo.name, 'scarewithin-youtube-mcp');
});

await test('MCP initialize falls back to the latest protocol for an unknown version', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal((await res.json()).result.protocolVersion, '2025-11-25');
});

await test('tools/list works without a token and exposes every capability', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(res.status, 200);
  const tools = (await res.json()).result.tools;
  const names = tools.map((t) => t.name);

  for (const required of [
    'youtube_get_channel',
    'youtube_list_videos',
    'youtube_search',
    'youtube_get_video',
    'youtube_upload_video',
    'youtube_update_video',
    'youtube_delete_video',
    'youtube_set_thumbnail',
    'youtube_create_playlist',
    'youtube_add_to_playlist',
    'youtube_remove_from_playlist',
    'youtube_list_comments',
    'youtube_reply_to_comment',
    'youtube_moderate_comment',
    'youtube_analytics_channel',
    'youtube_analytics_video',
  ]) {
    assert.ok(names.includes(required), `missing tool: ${required}`);
  }

  for (const t of tools) {
    assert.ok(t.description?.length > 20, `${t.name} needs a real description`);
    assert.equal(t.inputSchema.type, 'object', `${t.name} has a malformed input schema`);
  }

  assert.equal(tools.find((t) => t.name === 'youtube_delete_video').annotations.destructiveHint, true);
  assert.equal(tools.find((t) => t.name === 'youtube_get_channel').annotations.readOnlyHint, true);
});

await test('notifications get 202 and no body', async () => {
  const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(res.status, 202);
  assert.equal(await res.text(), '');
});

/* --------------------- lazy-auth gate (the key one) --------------------- */

await test('tools/call without a token returns 401 with the canonical challenge', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'youtube_get_channel', arguments: {} } });
  assert.equal(res.status, 401, 'must be a transport-level 401, not a 200 with isError');

  const challengeHeader = res.headers.get('www-authenticate');
  assert.ok(challengeHeader, 'WWW-Authenticate header is missing');
  assert.ok(challengeHeader.startsWith('Bearer '), 'challenge must use the Bearer scheme');
  assert.ok(
    challengeHeader.includes(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`),
    `resource_metadata pointer is wrong: ${challengeHeader}`,
  );
  assert.ok(/scope="[^"]+"/.test(challengeHeader), 'challenge should name the scopes to request');
});

await test('tools/call with a garbage bearer token also returns 401', async () => {
  const res = await rpc(
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'youtube_get_channel', arguments: {} } },
    { authorization: 'Bearer ymcp1_not-a-real-token' },
  );
  assert.equal(res.status, 401);
});

await test('a token minted for a different resource is refused (RFC 8707 audience binding)', async () => {
  const foreign = seal(
    'at',
    { rt: 'x', at: 'y', ax: Math.floor(Date.now() / 1000) + 999, sc: ['youtube.read'], aud: 'https://someone-else.example.com/mcp' },
    600,
  );
  const res = await rpc(
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'youtube_get_channel', arguments: {} } },
    { authorization: `Bearer ${foreign}` },
  );
  assert.equal(res.status, 401, 'a token for another audience must not be accepted');
});

await test('a valid access token resolves to a usable Google credential', async () => {
  // Asserted at the unit level: driving this through tools/call would reach
  // Google with a fake token and come back 401, which the server correctly
  // (but indistinguishably) reports as a re-authorization challenge.
  const { resolveAccessToken } = await import('../lib/oauth.js');
  const session = await resolveAccessToken({ headers: {} }, accessToken);
  assert.ok(session, 'a freshly issued access token was rejected');
  assert.equal(session.googleAccessToken, 'fake-google-access-token');
  assert.deepEqual(session.scopes, ['youtube.read', 'youtube.manage', 'analytics.read']);
});

await test('an expired access token is rejected', async () => {
  const { resolveAccessToken } = await import('../lib/oauth.js');
  const expired = seal('at', { rt: 'x', at: 'y', ax: 1, sc: [], aud: `${BASE}/mcp` }, -1);
  assert.equal(await resolveAccessToken({ headers: {} }, expired), null);
});

await test('an upstream Google 401 becomes a re-authorization challenge', async () => {
  // The stored Google grant can be revoked at any time; when that happens the
  // server must challenge rather than report a plain tool error, so Claude
  // re-runs OAuth instead of telling the user to "sign in" in prose.
  const res = await rpc(
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'youtube_get_channel', arguments: {} } },
    { authorization: `Bearer ${accessToken}` },
  );
  assert.equal(res.status, 401);
  assert.ok(res.headers.get('www-authenticate')?.includes('resource_metadata='));
});

/* --------------------- destructive-operation guard --------------------- */

await test('youtube_delete_video demands a matching confirm argument', async () => {
  const { findTool } = await import('../lib/tools.js');
  const tool = findTool('youtube_delete_video');
  assert.ok(tool.inputSchema.required.includes('confirm'));
  await assert.rejects(
    () => tool.run({ token: 'unused' }, { videoId: 'abc123', confirm: 'yes' }),
    /confirm.*must exactly equal videoId/i,
    'a mismatched confirm value must abort before any API call',
  );
});

/* ------------------------------- misc ------------------------------- */

await test('unknown paths return a clean 404', async () => {
  const res = await fetch(`${BASE}/nope`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'not_found');
});

await test('GET /mcp returns 405 (no server-initiated SSE stream)', async () => {
  const res = await fetch(`${BASE}/mcp`);
  assert.equal(res.status, 405);
  assert.ok(res.headers.get('allow').includes('POST'));
});

server.close();
console.log(`\n${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length ? 1 : 0);
