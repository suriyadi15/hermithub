# Changelog

## 0.8.0 — 2026-10-18

- **New logo**: a hermit crab in its shell, in the dashboard, the website and the catalog assets in
  `deploy/assets/`.
- **One volume for Docker, and one-click deploy.** The image keeps everything in the home of the container
  user, `/home/hermithub`, laid out like a standalone install: database in `~/.hermithub`, projects in
  `~/projects`. With a single volume it runs on hosting platforms: a Render Blueprint (`render.yaml`), a
  Coolify template (`deploy/coolify/`) and the values for a Railway template (`deploy/railway.md`). See
  [docs/one-click-deploy.md](docs/one-click-deploy.md). `HERMITHUB_PROJECTS` (or `install.sh --projects DIR`)
  still keeps projects in another host folder. The setup link in the logs uses the domain Railway or Render
  assigned.
- **The remaining `hub` names are now `hermithub`**: the container user and its home (`/home/hermithub`), every
  `HUB_*` variable (`HERMITHUB_PASSWORD`, `HERMITHUB_PORT`, ...), the tmux server (`tmux -L hermithub`) and its
  sessions, the database file (`hermithub.db`, renamed on start), `.hermithub-trash` and `.hermithub-worktrees`
  in the projects folder, and the session cookie (log in again).
- **Breaking for Docker installs**: move the data once, with the container stopped:
  ```bash
  cd ~/hermithub && docker compose down
  mv data/home/{.[!.],}* data/ && rmdir data/home
  mkdir -p data/.hermithub && mv data/db/* data/.hermithub/ && rmdir data/db
  [ -d data/caddy ] && mv data/caddy caddy
  cd data/projects && mv .hub-trash .hermithub-trash; mv .hub-worktrees .hermithub-worktrees; cd ../..
  # Claude Code keys its history by path
  (cd data/.claude/projects && for d in -home-hub-*; do mv "$d" "${d/-home-hub-/-home-hermithub-}"; done)
  sed -i 's|/home/hub/|/home/hermithub/|g' data/.claude.json
  sed -i 's/^HUB_/HERMITHUB_/' .env
  curl -fsSLO https://raw.githubusercontent.com/suriyadi15/hermithub/main/docker-compose.yml
  docker compose pull && docker compose up -d
  ```
  Then run `git worktree repair` in projects that have worktrees. Standalone installs: rename `HUB_*` in
  `~/.config/hermithub/env` and re-run the installer to refresh the service; folders inside `~/projects` move as
  above.

## 0.7.0 — 2026-10-18

- **Favorite and hide projects.** Star a project on the Dashboard to pin it in a "Favorites" group at the top.
  Hide projects you no longer touch from the card menu (with Undo); "Hidden (N)" next to the search box shows
  them again, and searching always finds them. Both flags are stored on the server, so every browser sees the
  same list, and they follow a project through rename and trash/restore.

## 0.6.1 — 2026-10-18

- **Website and docs** at [hermithub.pages.dev](https://hermithub.pages.dev): a landing page with screenshots and
  the documentation from `docs/`, with search. It is built from `site/` (Astro Starlight) and deployed to
  Cloudflare Pages on every push to `main`. See [docs/development.md](docs/development.md#website).

## 0.6.0 — 2026-10-18

- **Project Hub is now HermitHub.** The repository is `suriyadi15/hermithub`, the command `hermithub`, the image
  `ghcr.io/suriyadi15/hermithub`, the data folder `~/.hermithub`, the settings `~/.config/hermithub`, the service
  `hermithub` (launchd: `dev.hermithub`) and the agent skill `hermithub`. Existing installs move over by
  themselves on their first start after the update, and the old paths stay as symlinks. Releases still include
  `project-hub-<target>` and the image is still published as `ghcr.io/suriyadi15/project-hub`, so older versions
  can update. See [docs/installation.md](docs/installation.md#installs-from-before-the-rename).

## 0.5.0 — 2026-10-17

- **Install without Docker.** Each release now ships a standalone `project-hub` executable for Linux (x64/arm64,
  glibc and musl) and macOS (Intel/Apple silicon), with the frontend built in. `install.sh` installs it by default.
  It detects the OS and CPU, installs tmux and git when missing, verifies the checksum, and runs Project Hub as a
  systemd user service or launchd agent. Agent sessions survive restarts and updates. `--docker` keeps the
  container install, and existing Docker installs keep updating as Docker. New options: `--prefix`, `--no-service`,
  `--uninstall`, `--purge`. See [docs/installation.md](docs/installation.md).
- `project-hub` commands: `serve`, `set-password`, `disable-2fa`, `doctor`, `update`, `auto-update`, `version`.
- **Updates from the dashboard or the terminal.** Project Hub checks for a new release every 6 hours and shows it in
  **Settings → Updates**. The standalone executable updates itself from there or with `project-hub update`: it
  verifies the checksum, swaps the file and restarts the service while agent sessions keep running. Automatic
  updates can be turned on or off in Settings, with `project-hub auto-update on|off` or `HUB_AUTO_UPDATE`.
  Docker installs show the new version and the `docker compose` command.
- Server stats work on macOS.

- **Stop session** on a session in a worktree can remove the worktree too (and its branch once merged), so a
  finished task is cleaned up in one step. Worktrees with uncommitted changes or other sessions are kept.

## 0.4.0 — 2026-10-17

- **Worktrees for parallel tasks.** **+ Session → Run in → New worktree** creates a separate folder and
  branch per task and starts the agent there. The file tree, search, editor and Git panel follow the
  selected session (or the switcher in the header). The new worktrees panel shows each task's branch,
  changes and sessions, merges a branch back with one click and removes finished worktrees, optionally
  with their branch. Renaming a project keeps its worktrees working. See [docs/worktrees.md](docs/worktrees.md).
- Git panel API: `POST /git/merge` and `/git/merge/abort`.

## 0.3.0 — 2026-10-17

- New agents: **OpenCode**, **GitHub Copilot CLI**, **Qwen Code** and **Crush** — installed, updated and
  logged in from Settings like the others, each with its own permission modes and "continue last conversation".

## 0.2.0 — 2026-10-17

- **Two-factor authentication (TOTP).** Optional second login step with a code from an authenticator app
  (Google Authenticator, 1Password, Aegis…), turned on in **Settings → Two-factor authentication** with a QR
  code. Codes cannot be reused, wrong codes count toward the login lockout, and ten single-use recovery
  codes are shown once. Turning it on signs out other devices.
- `bun run disable-2fa` turns it off from the server if the authenticator and recovery codes are lost.

## 0.1.1 — 2026-10-17

Security:

- Login lockout could be bypassed by sending a different `X-Forwarded-For` / `CF-Connecting-IP` header on
  each attempt, allowing unlimited password guessing. Forwarded headers are now ignored unless
  `TRUST_PROXY` is set (`1` = last `X-Forwarded-For` entry, `cloudflare` = `CF-Connecting-IP`);
  `install.sh --domain` sets `TRUST_PROXY=1`. A global limit (30 failures / 15 min) backs up the per-IP one.
- Session tokens are stored as SHA-256 hashes. Existing logins are signed out once after updating.
- Security headers on every response: `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`,
  `Referrer-Policy: no-referrer`.
- File downloads are always `application/octet-stream` and only serve regular files.

## 0.1.0 — 2026-10-17

First open-source release.

- One-command install (`install.sh`) with a prebuilt image; optional built-in HTTPS via Caddy.
- Self-contained storage under `./data`; no host tools or dotfiles needed.
- First-run setup page with a one-time token (replaces `HUB_PASSWORD` in `.env`).
- Multiple agents: Claude Code, Codex CLI, Gemini CLI — installed, updated and logged in from Settings,
  with optional API keys and per-agent permission modes.
- GitHub login from the dashboard (device code or token), git identity and SSH key settings.
- English UI.
- Agent Skill (`skills/project-hub`) so Claude Code, Codex and other agents can install and operate Project Hub;
  installable as a Claude Code plugin.
