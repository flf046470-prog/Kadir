/**
 * Runtime configuration.
 *
 * Every secret is read from the environment. Nothing is ever logged, echoed in
 * an HTTP response, or written to disk. `describeConfig()` deliberately reports
 * only booleans so a health check can never leak a value.
 */

const REQUIRED = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TOKEN_SECRET'];

/** Public base URL of this deployment, without a trailing slash. */
export function baseUrl(req) {
  const explicit = process.env.PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  // Vercel injects the stable production domain into every deployment
  // (including previews), which keeps the OAuth issuer and the Google redirect
  // URI constant across redeploys.
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod}`;

  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  if (!host) throw new Error('Cannot determine base URL');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

export const mcpPath = '/mcp';

export function mcpUrl(req) {
  return baseUrl(req) + mcpPath;
}

/** The single redirect URI that must be registered on the Google Web client. */
export function googleRedirectUri(req) {
  return process.env.GOOGLE_REDIRECT_URI || `${baseUrl(req)}/oauth/google/callback`;
}

export function googleClientId() {
  const v = process.env.GOOGLE_CLIENT_ID;
  if (!v) throw new ConfigError('GOOGLE_CLIENT_ID is not configured');
  return v;
}

export function googleClientSecret() {
  const v = process.env.GOOGLE_CLIENT_SECRET;
  if (!v) throw new ConfigError('GOOGLE_CLIENT_SECRET is not configured');
  return v;
}

export function tokenSecret() {
  const v = process.env.TOKEN_SECRET;
  if (!v) throw new ConfigError('TOKEN_SECRET is not configured');
  if (v.length < 32) throw new ConfigError('TOKEN_SECRET must be at least 32 characters');
  return v;
}

/** When true, every write/destructive tool is hidden and refused. */
export function readOnlyMode() {
  return /^(1|true|yes)$/i.test(process.env.MCP_READ_ONLY || '');
}

/** Revenue analytics needs an extra Google scope, so it is opt-in. */
export function monetaryAnalyticsEnabled() {
  return /^(1|true|yes)$/i.test(process.env.ENABLE_REVENUE_ANALYTICS || '');
}

export class ConfigError extends Error {}

/** Booleans only — never values. Safe to serve publicly. */
export function describeConfig() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  return {
    configured: missing.length === 0,
    missing_env: missing,
    read_only: readOnlyMode(),
    revenue_analytics: monetaryAnalyticsEnabled(),
  };
}
