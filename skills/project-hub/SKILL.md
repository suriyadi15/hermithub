---
name: project-hub
description: Install, update, configure, troubleshoot or uninstall Project Hub — the self-hosted web dashboard that runs AI coding agents (Claude Code, Codex CLI, Gemini CLI) in one Docker container. Use when the user says things like "install Project Hub", "set up project-hub on my server/VPS", "deploy the agent dashboard with my domain", "update Project Hub", "Project Hub won't start", "I lost the setup link", "reset the Project Hub password", or "remove Project Hub".
---

# Project Hub — install & operate

Project Hub: https://github.com/suriyadi15/project-hub. One container, all data under `<install dir>/data`.
Nothing is installed on the host besides Docker. Agents, GitHub login and git settings are configured
afterwards **in the dashboard by the user**, not by you.

Commands below run on the **target machine** (the computer or server that will host the hub). If that is a
remote server, run them over `ssh user@host '…'` or in a session there.

## Ground rules

- **Ask before anything privileged or outward-facing**: installing Docker, using `sudo`, opening ports,
  `--public`, `--domain` (it requests a public TLS certificate), deleting `data/`.
- **Never expose the dashboard over plain HTTP to the internet.** It is a remote shell. Default to
  localhost; use `--domain` (HTTPS) or a tunnel for remote access.
- **Do not create the dashboard password yourself** unless the user explicitly asks you to (then use
  `HUB_PASSWORD`, see below). Give the user the setup link instead.
- Treat the setup token and passwords as secrets: show them to the user once, do not write them to
  files, commits, issues or chat logs beyond that.
- Do not log in to agents or GitHub on the user's behalf; those flows are done in the dashboard UI.

## 1. Gather what you need

Ask only what you cannot detect:

1. **Where** to install: this machine, or a remote host (`ssh` target)?
2. **How it will be reached**:
   - only from this machine → default (localhost),
   - from anywhere with a domain → `--domain hub.example.com` (DNS A/AAAA record must already point to
     the server; ports 80/443 free and open),
   - via SSH tunnel / Tailscale / Cloudflare Tunnel → default, then point the user to
     `docs/reverse-proxy.md`.
3. Install folder (default `~/project-hub`) and port (default `8787`) — only if the user cares.

## 2. Preflight checks

```bash
uname -sm                                   # Linux x86_64/aarch64 or Darwin
command -v docker && docker info >/dev/null 2>&1 && echo docker-ok
docker compose version                      # needs Compose v2
sudo -n true 2>/dev/null && echo sudo-nopass   # can you sudo without a prompt?
ls ~/project-hub/docker-compose.yml 2>/dev/null && echo existing-install
```

For `--domain`: `curl -s https://api.ipify.org` vs `getent hosts <domain>` (they should match) and
`sudo ss -ltnp | grep -E ':(80|443) '` (must be free).

- **No Docker on Linux**: ask the user, then let the installer install it with `--yes`. It needs root or
  passwordless sudo. If sudo asks for a password, ask the user to run the install command themselves
  (in Claude Code they can type `! <command>`).
- **No Docker on macOS/Windows**: the user must install Docker Desktop; stop and tell them.
- **Docker installed but `docker info` fails with permission denied**: the installer falls back to
  `sudo docker`. Mention that logging out/in after `usermod -aG docker $USER` avoids that.
- **Existing install**: re-running the installer is an update (keeps `.env` and data). Say so.

## 3. Install

Non-interactive (you have no TTY, so always pass `--yes`, after the user agreed to what it implies):

```bash
curl -fsSL https://raw.githubusercontent.com/suriyadi15/project-hub/main/install.sh | bash -s -- --yes
# with HTTPS on a domain:
curl -fsSL https://raw.githubusercontent.com/suriyadi15/project-hub/main/install.sh | bash -s -- --yes --domain hub.example.com
```

Other flags: `--dir PATH`, `--port N`, `--version TAG`, `--public` (all interfaces — only on a private
network/VPN and only if the user insists).

The installer downloads `docker-compose.yml`, writes `.env` (PUID/PGID of the current user), creates
`data/{home,projects,db}`, pulls `ghcr.io/suriyadi15/project-hub`, starts it, waits for
`/api/health` and prints the **setup link**.

**If the image pull fails** (`manifest unknown`, `denied`, `not found` — no release published yet, or the
package is private), build from source instead:

```bash
git clone https://github.com/suriyadi15/project-hub ~/project-hub-src
cd ~/project-hub-src
printf 'PUID=%s\nPGID=%s\n' "$(id -u)" "$(id -g)" > .env
mkdir -p data/home data/projects data/db
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

(The first build takes a few minutes.) The install folder is then `~/project-hub-src`.

**Headless password** (only if the user asked you to set it): before the first start add
`HUB_PASSWORD=<their password>` to `.env`; it seeds the password and the setup page is skipped.

## 4. Verify and hand over

```bash
cd ~/project-hub                       # or the folder you used
docker compose ps                      # project-hub should be "running (healthy)"
curl -fsS http://127.0.0.1:${PORT:-8787}/api/health    # {"ok":true}
cat data/db/setup-token                # exists until a password is set
```

Tell the user:

1. The setup link: `http://localhost:8787/setup?token=<token>` (or `https://<domain>/setup?token=…`).
   From another computer without a domain: `ssh -L 8787:localhost:8787 <user>@<server>` first, then open
   the localhost link.
2. Next steps in the dashboard: **Settings → AI agents → Install** (Claude Code / Codex / Gemini) →
   **Log in** (or paste an API key) → **Settings → GitHub → Log in with GitHub** → set **Git identity**.
3. Data lives in `<install dir>/data`; back that folder up.

With `--domain`, Caddy may need up to a minute for the certificate; check
`docker compose logs caddy` if HTTPS fails.

## Operate

Run from the install folder.

| Task | Command |
|---|---|
| Update | `docker compose pull && docker compose up -d` (or re-run the installer). Warn: this stops running sessions; conversations can be resumed. Source installs: `git pull && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build` |
| Logs | `docker compose logs -f project-hub` |
| Lost setup link | `cat data/db/setup-token` or `docker compose logs project-hub \| grep setup` |
| Forgot password | `docker compose exec -u hub project-hub bun run set-password` (interactive; the user should run it, or pass the new password as an argument only if they asked you to) |
| Shell in the container | `docker compose exec -u hub project-hub bash -l` — always `-u hub`, never as root |
| Change port / domain | edit `.env` (`HUB_PORT`, `COMPOSE_PROFILES=https`, `HUB_DOMAIN`, `PUBLIC_ORIGIN=https://<domain>`), then `docker compose up -d` |
| Stop | `docker compose down` |
| Uninstall | `docker compose down`, then — **only after explicit confirmation, it deletes all projects and logins** — `rm -rf <install dir>` |

All `.env` options: `docs/configuration.md` in the repo.

## Troubleshooting

See [references/troubleshooting.md](references/troubleshooting.md) for symptoms → causes → fixes
(container restarting, permission errors in `data/`, HTTPS/certificate problems, 403 "Origin not
allowed", agent install/login failures, sessions gone after an update).
