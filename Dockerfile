# FioreMatch server image.
#
# Three stages so the thing that ships carries neither the build toolchain nor
# the dependency tree: `next build` with `output: standalone` traces the modules
# the server actually reaches and writes a `server.js` that runs without
# `node_modules`. The result is the application and the handful of files it
# touches, rather than a copy of the repository.

# ---- deps -------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# Only the manifests, so this layer is cached until a dependency actually
# changes. Copying the source here would rebuild the tree on every edit.
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Asked for explicitly: the config leaves the default alone unless this is set,
# so a hosted build that does its own packaging is unaffected.
ENV NEXT_OUTPUT=standalone
ENV NEXT_TELEMETRY_DISABLED=1

# No DATABASE_URL here, and none is needed. Every route that reads the database
# is `force-dynamic`, so the build never opens a connection — which is also why
# a build cannot accidentally bake a production credential into the image.
RUN npm run build

# ---- run --------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# An unprivileged user. The image has no reason to write anything outside
# /tmp, and a container that runs as root turns a code-execution bug into a
# host problem.
RUN addgroup -g 1001 -S fiore && adduser -u 1001 -S fiore -G fiore

# `standalone` holds the server and its traced modules; `static` and `public`
# are served from disk and are not traced into it.
COPY --from=build --chown=fiore:fiore /app/.next/standalone ./
COPY --from=build --chown=fiore:fiore /app/.next/static ./.next/static
COPY --from=build --chown=fiore:fiore /app/public ./public

USER fiore
EXPOSE 3000

# The readiness probe reaches the database, so an instance that is up but
# cannot read is taken out of rotation rather than left serving errors.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
