/**
 * JSON-RPC 2.0 dispatch for the MCP Streamable HTTP transport.
 *
 * The server is fully stateless: no session is retained between requests, so
 * every POST is handled in isolation and no Mcp-Session-Id is issued.
 */

import { listTools, findTool } from './tools.js';
import { readOnlyMode } from './config.js';
import { YouTubeApiError } from './google.js';

const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST_PROTOCOL = SUPPORTED_PROTOCOLS[0];

const SERVER_INFO = {
  name: 'scarewithin-youtube-mcp',
  title: 'ScareWithin YouTube',
  version: '1.0.0',
};

export const AUTH_REQUIRED = Symbol('auth-required');

function rpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/** JSON-RPC methods that are usable before the user has authorized. */
const PUBLIC_METHODS = new Set([
  'initialize',
  'notifications/initialized',
  'notifications/cancelled',
  'ping',
  'tools/list',
  'resources/list',
  'resources/templates/list',
  'prompts/list',
]);

export function requiresAuth(message) {
  return message?.method === 'tools/call';
}

/** True when any message in the (possibly batched) body needs a token. */
export function bodyRequiresAuth(body) {
  const messages = Array.isArray(body) ? body : [body];
  return messages.some(requiresAuth);
}

export async function dispatch(message, ctx) {
  const { id, method, params } = message || {};

  if (!method || typeof method !== 'string') {
    return rpcError(id, -32600, 'Invalid Request: missing method');
  }

  // Notifications carry no id and must not produce a response.
  const isNotification = id === undefined || id === null;

  if (method.startsWith('notifications/')) return null;

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : LATEST_PROTOCOL;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Tools for managing the authorized YouTube channel: channel and video reads, search, playlists, comments and YouTube Analytics. ' +
          (readOnlyMode()
            ? 'This deployment runs in read-only mode; no write tools are available.'
            : 'Write tools are available. youtube_delete_video is irreversible and requires an explicit confirm argument — always ask the user before calling it.'),
      });
    }

    case 'ping':
      return isNotification ? null : rpcResult(id, {});

    case 'tools/list':
      return rpcResult(id, { tools: listTools() });

    case 'resources/list':
      return rpcResult(id, { resources: [] });

    case 'resources/templates/list':
      return rpcResult(id, { resourceTemplates: [] });

    case 'prompts/list':
      return rpcResult(id, { prompts: [] });

    case 'tools/call': {
      const name = params?.name;
      const tool = findTool(name);
      if (!tool) {
        return rpcError(id, -32602, `Unknown tool: ${name}`);
      }
      if (!ctx.token) {
        // Should be caught by the HTTP-layer gate; kept as defence in depth.
        return AUTH_REQUIRED;
      }
      try {
        const output = await tool.run(ctx, params?.arguments || {});
        return rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        });
      } catch (err) {
        if (err instanceof YouTubeApiError && (err.status === 401 || err.status === 403)) {
          // Let the transport turn this into a 401/403 so Claude re-prompts.
          if (err.status === 401) return AUTH_REQUIRED;
        }
        return rpcResult(id, {
          isError: true,
          content: [{ type: 'text', text: describeToolError(err) }],
        });
      }
    }

    default:
      return isNotification ? null : rpcError(id, -32601, `Method not found: ${method}`);
  }
}

/** Human-readable, never leaks tokens or secrets. */
function describeToolError(err) {
  if (err instanceof YouTubeApiError) {
    if (err.reason === 'quotaExceeded') {
      return 'YouTube API daily quota exceeded for this Google Cloud project. The quota resets at midnight Pacific Time, or request more in the Google Cloud console.';
    }
    if (err.reason === 'forbidden' || err.status === 403) {
      return `YouTube refused this operation: ${err.message}. This usually means the granted OAuth scope does not cover it, or the channel is not verified for this feature.`;
    }
    if (err.status === 404) return `Not found: ${err.message}`;
    return `YouTube API error (${err.status}): ${err.message}`;
  }
  return err?.message ? String(err.message) : 'Unexpected error while calling the YouTube API.';
}

export { SUPPORTED_PROTOCOLS, LATEST_PROTOCOL };
