# syntax=docker/dockerfile:1

# ---- dependencies (shared by build and runtime) ----
FROM oven/bun:1-debian AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY server/package.json server/
COPY web/package.json web/
RUN bun install --frozen-lockfile

# ---- build the React frontend ----
FROM deps AS build
COPY . .
RUN bun run build

# ---- server-only dependencies ----
FROM oven/bun:1-debian AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY server/package.json server/
COPY web/package.json web/
RUN bun install --frozen-lockfile --production --filter @hermithub/server

# ---- Node.js, needed by npm-distributed agents (Codex, Gemini CLI, ...) ----
FROM node:22-bookworm-slim AS node

# ---- base: Bun + Node + tmux + git + gh (also usable for development) ----
FROM oven/bun:1-debian AS base

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      tmux git gh openssh-client ca-certificates curl tini procps less nano vim-tiny ripgrep jq unzip \
      xz-utils libstdc++6 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node --version && npm --version

# The image's own `bun` user would take uid 1000; replace it with `hermithub`. The entrypoint remaps
# its uid/gid to PUID/PGID at start, so one image works for any host user.
RUN userdel -r bun 2>/dev/null; groupdel bun 2>/dev/null; \
    groupadd -g 1000 hermithub \
 && useradd -m -s /bin/bash -u 1000 -g 1000 hermithub \
 && mkdir -p /home/hermithub/projects \
 && chown hermithub:hermithub /home/hermithub/projects

# Agents (Claude Code, Codex, Gemini CLI, ...) are installed from the dashboard into ~/.local, which
# lives in the persistent home volume, so they survive image updates and can update themselves.
ENV HOME=/home/hermithub \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    NPM_CONFIG_PREFIX=/home/hermithub/.local \
    PATH=/home/hermithub/.local/bin:/home/hermithub/.bun/bin:$PATH
COPY docker/profile.sh /etc/profile.d/hermithub.sh
COPY docker/entrypoint.sh /usr/local/bin/hermithub-entrypoint
RUN chmod 755 /usr/local/bin/hermithub-entrypoint
WORKDIR /app
ENTRYPOINT ["tini", "--", "hermithub-entrypoint"]

# ---- runtime ----
FROM base AS runtime
ARG VERSION=""
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY --from=build /app/web/dist ./web/dist

LABEL org.opencontainers.image.title="HermitHub" \
      org.opencontainers.image.description="Self-hosted web dashboard for projects and AI coding agents" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$VERSION"
ENV HOST=0.0.0.0 \
    PORT=8787 \
    WEB_DIST=/app/web/dist \
    HERMITHUB_VERSION=$VERSION \
    HERMITHUB_DOCKER=1 \
    NODE_ENV=production
EXPOSE 8787
VOLUME ["/home/hermithub"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -fsS http://127.0.0.1:${PORT:-8787}/api/health || exit 1

CMD ["bun", "server/src/index.ts"]
