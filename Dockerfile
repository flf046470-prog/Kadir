# Kangaroo Chase authoritative game server.
#
# This is a stateful process: it holds WebSocket connections and runs a 60 Hz simulation per
# room. It belongs on a container host or a VM, never on serverless — a function that can be
# frozen or relocated between requests cannot hold a match together.
#
#   docker build -t kangaroo-chase .
#   docker run --rm -p 8787:8787 -e KC_SESSION_SECRET=$(openssl rand -hex 32) kangaroo-chase

# ---------------------------------------------------------------------------------------------
# Build: full dependency tree, then the production bundles.
# ---------------------------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Only the manifests first, so a source-only change reuses the cached install layer. Every
# workspace manifest has to be present or `npm ci` refuses the lockfile.
COPY package.json package-lock.json ./
COPY packages/core/package.json      packages/core/
COPY packages/net/package.json       packages/net/
COPY packages/server/package.json    packages/server/
COPY packages/client/package.json    packages/client/
COPY packages/shell/package.json     packages/shell/
RUN npm ci

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------------------------
# Runtime: production dependencies only, no toolchain, no sources.
# ---------------------------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Reinstalled from the same lockfile rather than copied from the build stage, so the runtime
# tree is exactly the production set — the build stage's devDependencies never ship.
COPY package.json package-lock.json ./
COPY packages/core/package.json      packages/core/
COPY packages/net/package.json       packages/net/
COPY packages/server/package.json    packages/server/
COPY packages/client/package.json    packages/client/
COPY packages/shell/package.json     packages/shell/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist/server ./dist/server
COPY --from=build /app/dist/client ./dist/client

# File storage is only correct for a single instance, but the directory has to exist and be
# writable either way: the server creates it at boot before it knows whether it will use it.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

ENV PORT=8787 HOST=0.0.0.0 KC_DATA_DIR=/data KC_PUBLIC_DIR=/app/dist/client
EXPOSE 8787

# Liveness, not readiness: if this fails the process is wedged and should be replaced.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form so the server is PID 1 and receives SIGTERM directly. main.ts handles it: stop the
# rooms, flush the leaderboard, then close. A shell wrapper would swallow the signal and the
# orchestrator would SIGKILL mid-match instead.
CMD ["node", "dist/server/main.js"]
