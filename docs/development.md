# Development

## Layout

```
server/            Bun + Elysia backend
  src/index.ts     app, auth guard, static files
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

## Checks

```bash
bun run typecheck
bun test server
```

CI runs both, builds the frontend and the image. Tagging `vX.Y.Z` publishes a multi-arch image to GHCR.

## Agent skill

`skills/project-hub/SKILL.md` documents the installer for AI agents. When installer flags, `.env` options or
operating commands change, update it (and `references/troubleshooting.md`), then check it with
`claude plugin validate --strict .`.

## Releasing

1. Update `CHANGELOG.md` and the `version` in `package.json`.
2. `git tag v0.2.0 && git push --tags`.
