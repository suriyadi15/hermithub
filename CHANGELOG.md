# Changelog

## Unreleased

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
