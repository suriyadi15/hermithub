# Changelog

## Unreleased

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
