# Development

## Layout

```
server/            Bun + Elysia backend
  src/index.ts     app, auth guard, static files
  src/cli.ts       `hermithub` executable: serve, set-password, disable-2fa, doctor, version
  src/agents.ts    agent registry (install, login, launch) + /api/agents
  src/sessions.ts  project sessions (tmux) + /api/sessions
  src/tasks.ts     system tasks: installs and logins in tmux + /api/tasks
  src/worktrees.ts git worktrees per project (parallel tasks) + /api/projects/:project/worktrees
  src/integrations.ts  GitHub, git identity, SSH key
  src/terminal.ts  WebSocket ⇄ tmux attach bridge
  src/tmux.ts      tmux helpers (dedicated socket "hub")
  src/auth.ts      setup token, password login, cookies, origin check
  src/files.ts, git.ts, search.ts, projects.ts, paths.ts
web/               React 19 + Vite frontend (Eden Treaty client typed from the server)
docker/            entrypoint (PUID/PGID remap) and shell profile
Dockerfile         multi-stage: deps → build → runtime
scripts/           build-binaries.ts: standalone executables → dist/
install.sh         installer: standalone executable (default) or Docker
site/              website: landing page + docs (Astro Starlight, Cloudflare Pages)
```

Sessions are tmux sessions on a private socket. Metadata (project, worktree, mode, label, task) is stored as tmux
user options (`@hub_*`), so the server can restart without losing track of running sessions.

## Run locally

With Bun and tmux installed:

```bash
bun install
bun run build                  # frontend → web/dist (or `bun run dev:web` for Vite with HMR)
DATA_DIR=.data PROJECTS_DIR=$PWD/.data/projects bun run dev:server
```

The setup link is printed on start. Bun reads `.env` from the working directory automatically.

Without Bun on the host, `./bunx.sh` runs it in the `oven/bun` image:

```bash
./bunx.sh bun install
./bunx.sh bun test server
./bunx.sh bun run build
```

## Build and run the image

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

## Build the standalone executable

```bash
bun run build:bin --host       # this platform only → dist/hermithub-<os>-<arch>
bun run build:bin              # every release target (Linux x64/arm64 glibc and musl, macOS x64/arm64)
bun run build:bin linux-arm64  # specific targets
```

It builds the frontend and compiles `server/src/cli.ts` with `bun build --compile`. A generated entry point embeds
every `web/dist` file (`server/src/web-embed.ts`), so the executable needs nothing next to it. `web/dist` on disk
(or `WEB_DIST`) still takes priority when it exists. Test the install script against a local build with
`HUB_DOWNLOAD_URL=file://$PWD/dist bash install.sh`.

## Checks

```bash
bun run typecheck
bun test server
```

CI runs both, builds the frontend and the image, and smoke-tests a standalone executable. Tagging `vX.Y.Z` publishes a
multi-arch image to GHCR and attaches the executables plus `SHA256SUMS` to the GitHub release.

## Agent skill

`skills/hermithub/SKILL.md` documents the installer for AI agents. When installer flags, `.env` options or
operating commands change, update it (and `references/troubleshooting.md`), then check it with
`claude plugin validate --strict .`.

## Website

`site/` is the website (landing page and docs), built with Astro Starlight and deployed to Cloudflare Pages at
https://projecthubapp.pages.dev. The docs pages are generated from `docs/*.md` on every build
(`site/scripts/sync-docs.ts`), so edit the files in `docs/`, not the generated copies. Links between docs files
(`installation.md`) become site links, and links outside `docs/` point to GitHub.

```bash
cd site
bun install
bun run dev        # http://localhost:4321
bun run build      # → site/dist, fails on broken internal links
```

The landing page is `site/src/content/docs/index.mdx`. Screenshots in `site/src/assets/screenshots` are taken from
a throwaway instance with demo projects, never from real data.

The `Website` workflow builds the site on pull requests that touch `docs/` or `site/`, and deploys it on pushes to
`main`. One-time setup:

1. In Cloudflare: **Workers & Pages → Create → Pages → Direct Upload**, name the project `projecthubapp`.
2. Create an API token with the **Cloudflare Pages: Edit** permission and note your account ID.
3. Add them as repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

To deploy by hand: `bun run build && bunx wrangler pages deploy dist --project-name=projecthubapp`.

## Releasing

1. Update `CHANGELOG.md` and the `version` in `package.json`.
2. `git tag v0.2.0 && git push --tags`.
