# ScareWithin YouTube — Remote MCP Server

A remote MCP server that lets Claude read and manage the ScareWithin YouTube
channel over OAuth 2.1. Zero runtime dependencies; deployed as a single Node
serverless function.

| | |
|---|---|
| **MCP endpoint** | `https://scarewithin-youtube-mcp.vercel.app/mcp` |
| **Google redirect URI** | `https://scarewithin-youtube-mcp.vercel.app/oauth/google/callback` |
| **Health check** | `https://scarewithin-youtube-mcp.vercel.app/health` |
| **Transport** | Streamable HTTP (JSON responses; no SSE upgrade) |
| **Auth** | OAuth 2.1 + PKCE S256 + Dynamic Client Registration (RFC 7591) |

## Why this exists instead of an off-the-shelf server

The well-known YouTube MCP projects (`pauling-ai/youtube-mcp-server` and
similar) are **local stdio servers**. They authenticate with Google's
*installed application* flow — the process opens a browser on the machine it
runs on and writes a token to `~/.youtube-mcp/token.json`. A hosted remote
connector has no browser and no durable per-user filesystem, so that design
cannot be pointed at Claude.ai.

Claude also cannot authorize against Google directly: Google supports neither
Dynamic Client Registration nor the arbitrary redirect URIs an MCP client
requires. So this server sits in the middle and plays both roles.

```
Claude.ai
   │  OAuth 2.1 · DCR · PKCE S256      ← this server is the authorization server
   ▼
YouTube MCP Server  (Vercel, HTTPS)
   │  OAuth 2.0 web-server flow        ← this server is a Google OAuth client
   ▼
Google  →  YouTube Data API v3 + YouTube Analytics API v2
   ▼
ScareWithin channel
```

Google's client secret never leaves the server. Claude only ever holds tokens
minted here.

## Configuration

Set these as **encrypted environment variables in the Vercel project**, never
in a file and never in a commit:

| Variable | Required | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` | yes | From the "Web application" OAuth client |
| `GOOGLE_CLIENT_SECRET` | yes | Same client. Encrypted at rest by Vercel |
| `TOKEN_SECRET` | yes | 32+ random bytes. `openssl rand -base64 48` |
| `GOOGLE_REDIRECT_URI` | no | Defaults to `<base>/oauth/google/callback` |
| `PUBLIC_BASE_URL` | no | Overrides the OAuth issuer. Only for custom domains |
| `MCP_READ_ONLY` | no | `1` hides and refuses every write tool |
| `ENABLE_REVENUE_ANALYTICS` | no | `1` also requests the monetary analytics scope |

`GET /health` reports which of these are missing as booleans — it never
returns a value.

## OAuth scopes

Least privilege: three Google scopes cover all 20 tools.

- `youtube.force-ssl` — channel/video reads, metadata edits, deletes, playlists, comments, moderation, thumbnails
- `youtube.upload` — video upload only
- `yt-analytics.readonly` — YouTube Analytics reads

`yt-analytics-monetary.readonly` (revenue) is **not** requested unless
`ENABLE_REVENUE_ANALYTICS=1`. `youtube.readonly` is dropped from the consent
screen when `force-ssl` is granted, since it is redundant.

## Endpoints

| Path | Purpose |
|---|---|
| `POST /mcp` | MCP Streamable HTTP endpoint |
| `GET /health` | Health check and configuration status |
| `GET /.well-known/oauth-protected-resource[/mcp]` | RFC 9728 |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 |
| `POST /oauth/register` | RFC 7591 dynamic client registration (JSON) |
| `GET /oauth/authorize` | Authorization endpoint → redirects to Google |
| `GET /oauth/google/callback` | Google's redirect target |
| `POST /oauth/token` | Token + refresh (form-urlencoded) |

## Security design

- **Stateless.** No database. Client registrations, authorization codes,
  access tokens and refresh tokens are AES-256-GCM sealed blobs that only this
  deployment's `TOKEN_SECRET` can open. The token *kind* is bound as additional
  authenticated data, so a refresh token cannot be replayed as an access token.
- **Audience binding** (RFC 8707): a token minted for a different resource URL
  is rejected.
- **PKCE S256 is mandatory** on every authorization request.
- **Refresh token rotation** on every refresh, per OAuth 2.1 for public clients.
- **No secrets in logs or responses.** Health output is booleans only; error
  paths never echo tokens.
- **Destructive-operation guard.** `youtube_delete_video` refuses to run unless
  `confirm` exactly equals `videoId`, and the tool description instructs the
  model to ask the user first. `MCP_READ_ONLY=1` removes write tools entirely.
- **Loopback redirect matching** per RFC 8252 §7.3, so Claude Code's ephemeral
  ports work alongside Claude.ai's fixed callback.

## Tests

```bash
npm test
```

Runs 26 offline checks covering discovery documents, dynamic client
registration, the Google authorization redirect, PKCE enforcement, token-kind
confusion, audience binding, the MCP handshake and the lazy-auth 401 gate.
No network or Google credentials required.

## Deploy / redeploy

From this directory, with the Vercel CLI authenticated:

```bash
npm i -g vercel          # once
vercel link --yes --project scarewithin-youtube-mcp
vercel --prod            # redeploy production
```

Environment variables persist across deployments — set them once in the Vercel
dashboard (Project → Settings → Environment Variables) and redeploy to pick up
changes.

Verify a deployment:

```bash
curl -s https://scarewithin-youtube-mcp.vercel.app/health | jq
```

## Note on deployment protection

The Vercel project uses Standard Protection: deployment-hash URLs and the team
alias require Vercel login, while the **production alias is public**. Claude
must be pointed at the production alias
(`https://scarewithin-youtube-mcp.vercel.app/mcp`) — a deployment-hash URL
returns a 302 to Vercel's login page and the connector will fail to connect.

## Known limits

- **Video upload** streams from a public HTTPS URL through the function, capped
  at ~64 MB and a 60 s execution window. Larger files need YouTube Studio or a
  host without a serverless timeout.
- **Custom thumbnails** require a verified YouTube channel; YouTube returns 403
  otherwise.
- **YouTube Data API quota** is 10,000 units/day by default. `search` costs 100
  units per call, so prefer `youtube_list_videos` for browsing the channel.
- Because tokens are stateless, a refresh token cannot be individually revoked
  before it expires. Rotating `TOKEN_SECRET` invalidates every issued token at
  once, which is the intended kill switch.
