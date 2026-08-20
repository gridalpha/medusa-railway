# syntax=docker/dockerfile:1

# Medusa publishes no runnable backend image — `create-medusa-app` scaffolds a
# project you build yourself — so this repo is the image. `medusa build` emits a
# self-contained app under .medusa/server with its own package.json, and that is
# what the runtime stage ships.

FROM node:22-bookworm-slim AS builder

# devDependencies (vite, react, typescript) are what build the admin dashboard,
# so this stage must not run as production.
ENV NODE_ENV=development
WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json medusa-config.ts ./
COPY src ./src

# DISABLE_MEDUSA_ADMIN is read here too: the worker service builds without the
# admin bundle, which is the only difference between the two images.
RUN npx medusa build

WORKDIR /app/.medusa/server
RUN npm install --omit=dev --no-audit --no-fund


FROM node:22-bookworm-slim AS runner

RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder --chown=node:node /app/.medusa/server ./
COPY --chown=node:node bin ./bin
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER node
EXPOSE 9000

# -s registers tini as a child subreaper, which it is not by default when it is
# not PID 1; TINI_KILL_PROCESS_GROUP passes SIGTERM to the whole group so a
# redeploy drains instead of being killed.
ENV TINI_KILL_PROCESS_GROUP=1
ENTRYPOINT ["/usr/bin/tini", "-s", "--", "/usr/local/bin/docker-entrypoint.sh"]
