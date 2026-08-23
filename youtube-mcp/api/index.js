/**
 * Single entry point. vercel.json rewrites every path here and passes the
 * original path through as `__p`, so one function serves the MCP endpoint,
 * the OAuth authorization server and the discovery documents from one origin.
 */

import {
  protectedResourceMetadata,
  authorizationServerMetadata,
  registerClient,
  buildGoogleAuthorizeRedirect,
  handleGoogleCallback,
  handleToken,
  resolveAccessToken,
  defaultScopeString,
  AuthorizeError,
  TokenError,
} from '../lib/oauth.js';
import { dispatch, bodyRequiresAuth, AUTH_REQUIRED } from '../lib/mcp.js';
import { baseUrl, mcpPath, googleRedirectUri, describeConfig, ConfigError } from '../lib/config.js';

/* ------------------------------ helpers ------------------------------ */

function requestPath(req) {
  const raw = req.query?.__p;
  if (typeof raw === 'string') return '/' + raw.replace(/^\/+/, '');
  const url = req.url || '/';
  return url.split('?')[0];
}

function queryOf(req) {
  const out = {};
  if (req.query && typeof req.query === 'object') {
    for (const [k, v] of Object.entries(req.query)) {
      if (k === '__p') continue;
      out[k] = Array.isArray(v) ? v[0] : v;
    }
  }
  const qi = (req.url || '').indexOf('?');
  if (qi !== -1) {
    for (const [k, v] of new URLSearchParams(req.url.slice(qi + 1))) {
      if (k !== '__p' && out[k] === undefined) out[k] = v;
    }
  }
  return out;
}

async function rawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return null; // already parsed
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

/** Parse a JSON body regardless of whether the platform pre-parsed it. */
async function jsonBody(req) {
  const raw = await rawBody(req);
  if (raw === null) return req.body;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined; // signals a parse error
  }
}

/** RFC 6749 requires the token endpoint to accept form-urlencoded. */
async function formBody(req) {
  const raw = await rawBody(req);
  if (raw === null) return { ...req.body };
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID');
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function json(res, status, payload, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(payload));
}

function discoveryJson(res, payload) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  json(res, 200, payload);
}

function html(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(body);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page(title, message, tone = 'error') {
  const color = tone === 'ok' ? '#15803d' : '#b91c1c';
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<div style="font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;max-width:38rem;margin:15vh auto;padding:0 1.5rem">
  <h1 style="font-size:1.35rem;margin:0 0 .75rem;color:${color}">${escapeHtml(title)}</h1>
  <p style="margin:0;color:#374151">${escapeHtml(message)}</p>
</div>`;
}

/** The canonical 401 challenge that makes Claude show its Connect card. */
function unauthorized(req, res, description = 'Authorization required to use this tool') {
  const challenge =
    `Bearer error="invalid_token", ` +
    `error_description="${description.replace(/"/g, "'")}", ` +
    `resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource${mcpPath}", ` +
    `scope="${defaultScopeString()}"`;
  json(res, 401, { error: 'invalid_token', error_description: description }, { 'WWW-Authenticate': challenge });
}

/* -------------------------------- router ------------------------------- */

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const path = requestPath(req);
  const query = queryOf(req);

  try {
    /* ---- landing + health ---- */

    if (path === '/' && req.method === 'GET') {
      const cfg = describeConfig();
      return html(
        res,
        200,
        page(
          'ScareWithin YouTube MCP',
          cfg.configured
            ? `Remote MCP server is running. Add ${baseUrl(req)}${mcpPath} as a custom connector in Claude.`
            : `Server is running but not fully configured. Missing environment variables: ${cfg.missing_env.join(', ')}.`,
          cfg.configured ? 'ok' : 'error',
        ),
      );
    }

    if (path === '/health') {
      return json(res, 200, {
        status: 'ok',
        service: 'scarewithin-youtube-mcp',
        mcp_endpoint: `${baseUrl(req)}${mcpPath}`,
        google_redirect_uri: googleRedirectUri(req),
        ...describeConfig(),
        timestamp: new Date().toISOString(),
      });
    }

    /* ---- OAuth discovery (RFC 9728 / RFC 8414) ---- */

    if (path === '/.well-known/oauth-protected-resource' || path === `/.well-known/oauth-protected-resource${mcpPath}`) {
      return discoveryJson(res, protectedResourceMetadata(req));
    }

    if (
      path === '/.well-known/oauth-authorization-server' ||
      path === `/.well-known/oauth-authorization-server${mcpPath}` ||
      path === '/.well-known/openid-configuration'
    ) {
      return discoveryJson(res, authorizationServerMetadata(req));
    }

    /* ---- Dynamic Client Registration (RFC 7591, application/json) ---- */

    if (path === '/oauth/register') {
      if (req.method !== 'POST') return json(res, 405, { error: 'invalid_request', error_description: 'POST required' });
      const body = await jsonBody(req);
      if (body === undefined) return json(res, 400, { error: 'invalid_client_metadata', error_description: 'Body is not valid JSON' });
      try {
        return json(res, 201, registerClient(body || {}));
      } catch (err) {
        return json(res, 400, { error: err.oauthError || 'invalid_client_metadata', error_description: err.message });
      }
    }

    /* ---- Authorization endpoint ---- */

    if (path === '/oauth/authorize') {
      if (req.method !== 'GET') return html(res, 405, page('Method not allowed', 'The authorization endpoint accepts GET requests.'));
      try {
        const target = buildGoogleAuthorizeRedirect(req, query);
        res.statusCode = 302;
        res.setHeader('Location', target);
        res.setHeader('Cache-Control', 'no-store');
        return res.end();
      } catch (err) {
        if (err instanceof AuthorizeError && err.redirectTo) {
          const u = new URL(err.redirectTo);
          u.searchParams.set('error', err.code);
          u.searchParams.set('error_description', err.message);
          if (query.state) u.searchParams.set('state', query.state);
          u.searchParams.set('iss', baseUrl(req));
          res.statusCode = 302;
          res.setHeader('Location', u.toString());
          return res.end();
        }
        if (err instanceof ConfigError) {
          return html(res, 500, page('Server not configured', `${err.message}. Set it in the hosting provider's environment variables and redeploy.`));
        }
        return html(res, 400, page('Authorization request rejected', err.message));
      }
    }

    /* ---- Google redirect URI — this exact path goes in Google Cloud ---- */

    if (path === '/oauth/google/callback') {
      try {
        const target = await handleGoogleCallback(req, query);
        res.statusCode = 302;
        res.setHeader('Location', target);
        res.setHeader('Cache-Control', 'no-store');
        return res.end();
      } catch (err) {
        if (err instanceof ConfigError) {
          return html(res, 500, page('Server not configured', `${err.message}. Set it in the hosting provider's environment variables and redeploy.`));
        }
        return html(res, 400, page('Could not complete sign-in', err.message));
      }
    }

    /* ---- Token endpoint (form-urlencoded) ---- */

    if (path === '/oauth/token') {
      if (req.method !== 'POST') {
        return json(res, 405, { error: 'invalid_request', error_description: 'POST required' }, { Allow: 'POST, OPTIONS' });
      }
      res.setHeader('Cache-Control', 'no-store');
      try {
        const form = await formBody(req);
        return json(res, 200, await handleToken(req, form));
      } catch (err) {
        if (err instanceof TokenError) {
          return json(res, err.status, { error: err.code, error_description: err.message });
        }
        if (err instanceof ConfigError) {
          return json(res, 500, { error: 'server_error', error_description: err.message });
        }
        return json(res, 400, { error: 'invalid_request', error_description: err.message });
      }
    }

    /* ---- MCP Streamable HTTP endpoint ---- */

    if (path === mcpPath) {
      if (req.method === 'GET') {
        // No server-initiated streams: spec allows refusing the SSE upgrade.
        return json(res, 405, { error: 'method_not_allowed', error_description: 'This server does not offer a server-initiated SSE stream.' }, { Allow: 'POST, DELETE, OPTIONS' });
      }
      if (req.method === 'DELETE') {
        res.statusCode = 204; // Stateless: nothing to tear down.
        return res.end();
      }
      if (req.method !== 'POST') {
        return json(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST, DELETE, OPTIONS' });
      }

      const body = await jsonBody(req);
      if (body === undefined || body === null) {
        return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      }

      const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];

      // Lazy-auth gate: refuse at the HTTP layer, before the JSON-RPC layer,
      // so Claude renders a Connect card instead of a tool error.
      let session = null;
      if (bearer) {
        try {
          session = await resolveAccessToken(req, bearer);
        } catch {
          session = null;
        }
      }
      if (!session && bodyRequiresAuth(body)) {
        return unauthorized(req, res);
      }

      const ctx = { token: session?.googleAccessToken || null, scopes: session?.scopes || [] };
      const messages = Array.isArray(body) ? body : [body];
      const responses = [];
      for (const message of messages) {
        const out = await dispatch(message, ctx);
        if (out === AUTH_REQUIRED) return unauthorized(req, res, 'The stored authorization is no longer valid');
        if (out) responses.push(out);
      }

      if (!responses.length) {
        res.statusCode = 202; // Notification-only batch.
        return res.end();
      }
      return json(res, 200, Array.isArray(body) ? responses : responses[0]);
    }

    return json(res, 404, { error: 'not_found', error_description: `No route for ${path}` });
  } catch (err) {
    // Never surface stack traces or anything that might embed a credential.
    console.error('unhandled error on', path, err?.message);
    return json(res, 500, { error: 'server_error', error_description: 'Internal server error' });
  }
}
