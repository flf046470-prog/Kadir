/**
 * OAuth 2.1 authorization server (facing Claude) bridged onto Google's
 * OAuth 2.0 web-server flow (facing YouTube).
 *
 * Claude cannot talk to Google directly: Google supports neither Dynamic
 * Client Registration nor the arbitrary redirect URIs an MCP client needs.
 * So this deployment plays both roles — authorization server for Claude,
 * OAuth client for Google — and never hands Google credentials to Claude.
 */

import { seal, unseal, SealError, verifyPkceS256 } from './crypto.js';
import {
  baseUrl,
  mcpUrl,
  googleClientId,
  googleClientSecret,
  googleRedirectUri,
  readOnlyMode,
  monetaryAnalyticsEnabled,
} from './config.js';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

const CODE_TTL = 600; // 10 minutes (RFC 6749 recommends <= 10 min)
const ACCESS_TTL = 3600; // 1 hour
const REFRESH_TTL = 60 * 60 * 24 * 90; // 90 days
const CLIENT_TTL = 60 * 60 * 24 * 365; // 1 year

/** MCP scope -> Google scope. Least privilege: each maps to the narrowest scope that works. */
const SCOPE_MAP = {
  'youtube.read': 'https://www.googleapis.com/auth/youtube.readonly',
  'youtube.manage': 'https://www.googleapis.com/auth/youtube.force-ssl',
  'youtube.upload': 'https://www.googleapis.com/auth/youtube.upload',
  'analytics.read': 'https://www.googleapis.com/auth/yt-analytics.readonly',
  'analytics.revenue': 'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
};

export function supportedScopes() {
  if (readOnlyMode()) return ['youtube.read', 'analytics.read'];
  const s = ['youtube.read', 'youtube.manage', 'youtube.upload', 'analytics.read'];
  if (monetaryAnalyticsEnabled()) s.push('analytics.revenue');
  return s;
}

export function defaultScopeString() {
  return supportedScopes().join(' ');
}

/** Keep only scopes we actually understand; ignore extras such as `offline_access`. */
function normalizeScopes(requested) {
  const allowed = new Set(supportedScopes());
  const picked = String(requested || '')
    .split(/[\s+]+/)
    .filter((s) => allowed.has(s));
  return picked.length ? picked : supportedScopes();
}

function toGoogleScopes(mcpScopes) {
  const out = new Set(['openid']);
  for (const s of mcpScopes) if (SCOPE_MAP[s]) out.add(SCOPE_MAP[s]);
  // force-ssl is a strict superset of readonly — drop the redundant one so the
  // Google consent screen stays as short as possible.
  if (out.has(SCOPE_MAP['youtube.manage'])) out.delete(SCOPE_MAP['youtube.read']);
  return [...out];
}

/* ------------------------------------------------------------------ *
 * Discovery documents
 * ------------------------------------------------------------------ */

export function protectedResourceMetadata(req) {
  return {
    resource: mcpUrl(req),
    authorization_servers: [baseUrl(req)],
    bearer_methods_supported: ['header'],
    scopes_supported: supportedScopes(),
    resource_documentation: `${baseUrl(req)}/`,
  };
}

export function authorizationServerMetadata(req) {
  const base = baseUrl(req);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    scopes_supported: supportedScopes(),
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${base}/`,
  };
}

/* ------------------------------------------------------------------ *
 * Dynamic Client Registration (RFC 7591)
 * ------------------------------------------------------------------ */

export function registerClient(body) {
  const redirectUris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
  if (!redirectUris.length) {
    const e = new Error('redirect_uris is required');
    e.oauthError = 'invalid_redirect_uri';
    throw e;
  }
  for (const uri of redirectUris) {
    let u;
    try {
      u = new URL(uri);
    } catch {
      const e = new Error(`invalid redirect_uri: ${uri}`);
      e.oauthError = 'invalid_redirect_uri';
      throw e;
    }
    const isLoopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname === '::1';
    if (u.protocol !== 'https:' && !isLoopback) {
      const e = new Error('redirect_uri must use https, or be a loopback address');
      e.oauthError = 'invalid_redirect_uri';
      throw e;
    }
  }

  const meta = {
    ru: redirectUris,
    n: typeof body.client_name === 'string' ? body.client_name.slice(0, 120) : 'MCP Client',
  };
  const clientId = seal('client', meta, CLIENT_TTL);
  const now = Math.floor(Date.now() / 1000);

  return {
    client_id: clientId,
    client_id_issued_at: now,
    redirect_uris: redirectUris,
    client_name: meta.n,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: defaultScopeString(),
  };
}

/**
 * RFC 8252 §7.3: loopback redirect URIs must match with the port ignored,
 * because a native client binds an ephemeral port at runtime. Claude Code
 * relies on this for both 127.0.0.1 and localhost.
 */
function redirectUriAllowed(candidate, registered) {
  let c;
  try {
    c = new URL(candidate);
  } catch {
    return false;
  }
  return registered.some((r) => {
    let u;
    try {
      u = new URL(r);
    } catch {
      return false;
    }
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
    if (loopbackHosts.has(u.hostname) && loopbackHosts.has(c.hostname)) {
      return u.protocol === c.protocol && u.pathname === c.pathname;
    }
    return u.protocol === c.protocol && u.host === c.host && u.pathname === c.pathname;
  });
}

/* ------------------------------------------------------------------ *
 * /oauth/authorize
 * ------------------------------------------------------------------ */

export class AuthorizeError extends Error {
  constructor(message, { redirectTo = null, code = 'invalid_request' } = {}) {
    super(message);
    this.redirectTo = redirectTo;
    this.code = code;
  }
}

export function buildGoogleAuthorizeRedirect(req, query) {
  const { client_id, redirect_uri, response_type, code_challenge, code_challenge_method, state, scope, resource } = query;

  let client;
  try {
    client = unseal('client', client_id);
  } catch {
    throw new AuthorizeError('Unknown or expired client_id. Reconnect the connector so it can register again.');
  }

  if (!redirect_uri || !redirectUriAllowed(redirect_uri, client.ru)) {
    throw new AuthorizeError('redirect_uri does not match any registered redirect URI for this client.');
  }

  // From here on, errors can safely be reported back to the client.
  const fail = (code, msg) => new AuthorizeError(msg, { redirectTo: redirect_uri, code });

  if (response_type !== 'code') throw fail('unsupported_response_type', 'Only response_type=code is supported.');
  if (!code_challenge) throw fail('invalid_request', 'PKCE code_challenge is required.');
  if (code_challenge_method !== 'S256') throw fail('invalid_request', 'code_challenge_method must be S256.');

  const scopes = normalizeScopes(scope);
  const audience = resource || mcpUrl(req);

  const stateBlob = seal(
    'authstate',
    {
      ru: redirect_uri,
      cc: code_challenge,
      st: typeof state === 'string' ? state : null,
      sc: scopes,
      aud: audience,
      ci: client_id,
    },
    CODE_TTL,
  );

  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: googleRedirectUri(req),
    response_type: 'code',
    scope: toGoogleScopes(scopes).join(' '),
    access_type: 'offline',
    // Force the consent screen so Google reliably returns a refresh_token —
    // without it, a repeat authorization yields no refresh token at all.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: stateBlob,
  });

  return `${GOOGLE_AUTH}?${params.toString()}`;
}

/* ------------------------------------------------------------------ *
 * /oauth/google/callback
 * ------------------------------------------------------------------ */

export async function handleGoogleCallback(req, query) {
  let st;
  try {
    st = unseal('authstate', query.state);
  } catch {
    throw new AuthorizeError('Authorization session expired or invalid. Start the connection again from Claude.');
  }

  const back = (params) => {
    const u = new URL(st.ru);
    for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
    if (st.st) u.searchParams.set('state', st.st);
    u.searchParams.set('iss', baseUrl(req));
    return u.toString();
  };

  if (query.error) {
    return back({ error: query.error, error_description: query.error_description || 'Google denied the request' });
  }
  if (!query.code) {
    return back({ error: 'invalid_request', error_description: 'Missing authorization code from Google' });
  }

  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: query.code,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      redirect_uri: googleRedirectUri(req),
      grant_type: 'authorization_code',
    }),
  });

  const tok = await res.json().catch(() => ({}));
  if (!res.ok || !tok.access_token) {
    // Google's error codes are safe to relay; tokens and secrets are not, and
    // none of them appear in this branch.
    return back({
      error: 'invalid_grant',
      error_description: `Google token exchange failed: ${tok.error || res.status}`,
    });
  }
  if (!tok.refresh_token) {
    return back({
      error: 'invalid_grant',
      error_description:
        'Google did not return a refresh token. Remove this app at myaccount.google.com/permissions and connect again.',
    });
  }

  const code = seal(
    'code',
    {
      rt: tok.refresh_token,
      at: tok.access_token,
      ax: Math.floor(Date.now() / 1000) + (Number(tok.expires_in) || 3600) - 60,
      cc: st.cc,
      ru: st.ru,
      ci: st.ci,
      sc: st.sc,
      aud: st.aud,
    },
    CODE_TTL,
  );

  return back({ code });
}

/* ------------------------------------------------------------------ *
 * /oauth/token
 * ------------------------------------------------------------------ */

export class TokenError extends Error {
  constructor(code, description, status = 400) {
    super(description);
    this.code = code;
    this.status = status;
  }
}

function issueTokens(payload) {
  return {
    access_token: seal('at', payload, ACCESS_TTL),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    // Rotated on every refresh, per OAuth 2.1 guidance for public clients.
    refresh_token: seal('rt', { rt: payload.rt, sc: payload.sc, aud: payload.aud }, REFRESH_TTL),
    scope: payload.sc.join(' '),
  };
}

export async function handleToken(req, form) {
  const grant = form.grant_type;

  if (grant === 'authorization_code') {
    let code;
    try {
      code = unseal('code', form.code);
    } catch (err) {
      throw new TokenError('invalid_grant', err instanceof SealError ? 'Authorization code is invalid or expired' : 'Invalid code');
    }
    if (form.client_id && form.client_id !== code.ci) {
      throw new TokenError('invalid_grant', 'client_id does not match the authorization code');
    }
    if (form.redirect_uri && form.redirect_uri !== code.ru) {
      throw new TokenError('invalid_grant', 'redirect_uri does not match the authorization request');
    }
    if (!verifyPkceS256(form.code_verifier, code.cc)) {
      throw new TokenError('invalid_grant', 'PKCE verification failed');
    }
    return issueTokens({ rt: code.rt, at: code.at, ax: code.ax, sc: code.sc, aud: code.aud });
  }

  if (grant === 'refresh_token') {
    let rt;
    try {
      rt = unseal('rt', form.refresh_token);
    } catch {
      // RFC 6749 requires invalid_grant here; Claude keys its re-auth prompt on it.
      throw new TokenError('invalid_grant', 'Refresh token is invalid or expired');
    }
    // Confirm Google still honours the grant before handing out a new token.
    const fresh = await refreshGoogleAccessToken(rt.rt);
    return issueTokens({ rt: rt.rt, at: fresh.access_token, ax: fresh.expires_at, sc: rt.sc, aud: rt.aud });
  }

  throw new TokenError('unsupported_grant_type', `grant_type "${grant}" is not supported`);
}

/** Exchange a Google refresh token for a fresh access token. */
export async function refreshGoogleAccessToken(googleRefreshToken) {
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: googleRefreshToken,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      grant_type: 'refresh_token',
    }),
  });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok || !tok.access_token) {
    throw new TokenError('invalid_grant', `Google refused the refresh token (${tok.error || res.status})`);
  }
  return {
    access_token: tok.access_token,
    expires_at: Math.floor(Date.now() / 1000) + (Number(tok.expires_in) || 3600) - 60,
  };
}

/**
 * Resolve a bearer token from Claude into a usable Google access token.
 * Returns null when the token is absent or unusable, so the caller can emit 401.
 */
export async function resolveAccessToken(req, bearer) {
  if (!bearer) return null;
  let at;
  try {
    at = unseal('at', bearer);
  } catch {
    return null;
  }

  // Audience binding (RFC 8707): a token minted for another resource must not work here.
  const expected = mcpUrl(req);
  if (at.aud && at.aud !== expected && at.aud !== baseUrl(req)) return null;

  if (at.at && at.ax && at.ax > Math.floor(Date.now() / 1000)) {
    return { googleAccessToken: at.at, scopes: at.sc };
  }
  const fresh = await refreshGoogleAccessToken(at.rt);
  return { googleAccessToken: fresh.access_token, scopes: at.sc };
}
