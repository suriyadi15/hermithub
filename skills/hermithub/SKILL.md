---
name: hermithub
description: Install, update, configure, troubleshoot or uninstall HermitHub — the self-hosted web dashboard that runs AI coding agents (Claude Code, Codex CLI, Gemini CLI, OpenCode, Copilot CLI, Qwen Code, Crush), installed as a standalone executable or a Docker container. Use when the user says things like "install HermitHub", "set up hermithub on my server/VPS", "deploy the agent dashboard with my domain", "update HermitHub", "HermitHub won't start", "I lost the setup link", "reset the HermitHub password", or "remove HermitHub".
---

# HermitHub — install & operate

HermitHub: https://github.com/suriyadi15/hermithub. Two install modes, both from `install.sh`:

- **Standalone** (default): one `hermithub` executable in `~/.local/bin`, run as a systemd user service
  (Linux) or launchd agent (macOS). Needs tmux and git. Settings in `~/.config/hermithub/env`, data in
  `~/.hermithub`, projects in `~/projects`. Agents run as the user, with no container in between.
- **Docker** (`--docker`): one container, all data under `<install dir>/data` (default `~/hermithub`).
  Agents are isolated from the host; built-in HTTPS with `--domain`.

HermitHub was called **Project Hub** up to v0.5.0. Old installs (`~/.local/bin/project-hub`, `project-hub.service`,
`~/.project-hub`, `~/project-hub` for Docker) move to the new names when updated or when the installer runs again;
the old paths stay as symlinks.

Agents, GitHub login and git settings are configured afterwards **in the dashboard by the user**, not by you.

Commands below run on the **target machine** (the computer or server that will host the hub). If that is a
remote server, run them over `ssh user@host '…'` or in a session there.

## Ground rules

- **Ask before anything privileged or outward-facing**: installing Docker, using `sudo`, opening ports,
  `--public`, `--domain` (it requests a public TLS certificate), deleting `data/`.
- **Never expose the dashboard over plain HTTP to the internet.** It is a remote shell. Default to
  localhost; use `--domain` (HTTPS) or a tunnel for remote access.
- **Do not create the dashboard password yourself** unless the user explicitly asks you to (then use
  `HERMITHUB_PASSWORD`, see below). Give the user the setup link instead.
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
3. **Mode**: standalone (no Docker, lighter, agents see the whole user account) or Docker (isolated, built-in
   HTTPS). `--domain` needs Docker. If Docker is already running there or the user wants isolation or
   `--domain`, suggest Docker; otherwise standalone. Windows is not supported (use WSL 2 with Docker).
4. Install folder (Docker, default `~/hermithub`) and port (default `8787`) — only if the user cares.

## 2. Preflight checks

```bash
uname -sm                                   # Linux x86_64/aarch64 or Darwin
id -u                                       # standalone refuses root (0): use or create a normal user
command -v tmux git node npm gh             # standalone: tmux + git required, the rest optional
systemctl --user show-environment >/dev/null 2>&1 && echo user-systemd   # standalone service on Linux
ls ~/.local/bin/hermithub 2>/dev/null && echo existing-standalone
command -v docker && docker info >/dev/null 2>&1 && echo docker-ok
docker compose version                      # needs Compose v2
sudo -n true 2>/dev/null && echo sudo-nopass   # can you sudo without a prompt?
ls ~/hermithub/docker-compose.yml 2>/dev/null && echo existing-install
```

For `--domain`: `curl -s https://api.ipify.org` vs `getent hosts <domain>` (they should match) and
`sudo ss -ltnp | grep -E ':(80|443) '` (must be free).

- **Standalone, tmux/git missing**: the installer installs them with the package manager (sudo) after
  asking; with `--yes` it does so without asking. On macOS it needs Homebrew.
- **Standalone, no systemd user session** (container, Alpine, `su` shell): the installer only installs the
  executable and prints the start command. On a server reached over SSH, log in as the user directly.
- **No Docker on Linux** (Docker mode): ask the user, then let the installer install it with `--yes`. It needs root or
  passwordless sudo. If sudo asks for a password, ask the user to run the install command themselves
  (in Claude Code they can type `! <command>`).
- **No Docker on macOS/Windows**: the user must install Docker Desktop; stop and tell them.
- **Docker installed but `docker info` fails with permission denied**: the installer falls back to
  `sudo docker`. Mention that logging out/in after `usermod -aG docker $USER` avoids that.
- **Existing install**: re-running the installer is an update (keeps `.env` and data). Say so.

## 3. Install

Non-interactive (you have no TTY, so always pass `--yes`, after the user agreed to what it implies):

```bash
# standalone executable:
curl -fsSL https://raw.githubusercontent.com/suriyadi15/hermithub/main/install.sh | bash -s -- --yes
# Docker:
curl -fsSL https://raw.githubusercontent.com/suriyadi15/hermithub/main/install.sh | bash -s -- --yes --docker
# Docker with HTTPS on a domain:
curl -fsSL https://raw.githubusercontent.com/suriyadi15/hermithub/main/install.sh | bash -s -- --yes --docker --domain hub.example.com
```

Other flags: `--port N`, `--version TAG`, `--public` (all interfaces — only on a private network/VPN and
only if the user insists); standalone: `--prefix PATH`, `--no-service`; Docker: `--dir PATH`.
Without `--docker`/`--native`, an existing Docker install in `~/hermithub` is updated as Docker.

**Standalone**: the installer downloads `hermithub-<os>-<arch>` from the GitHub release, verifies
`SHA256SUMS`, writes `~/.config/hermithub/{env,run.sh}`, starts the service (on Linux it asks to
`loginctl enable-linger` so it survives logout), waits for `/api/health` and prints the **setup link**.
If the download fails (no release with executables yet), use `--docker` or run from source
(`docs/development.md`).

**Docker**: the installer downloads `docker-compose.yml`, writes `.env` (PUID/PGID of the current user), creates
`data/{home,projects,db}`, pulls `ghcr.io/suriyadi15/hermithub`, starts it, waits for
`/api/health` and prints the **setup link**.

**If the image pull fails** (`manifest unknown`, `denied`, `not found` — no release published yet, or the
package is private), build from source instead:

```bash
git clone https://github.com/suriyadi15/hermithub ~/hermithub-src
cd ~/hermithub-src
printf 'PUID=%s\nPGID=%s\n' "$(id -u)" "$(id -g)" > .env
mkdir -p data/projects
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

(The first build takes a few minutes.) The install folder is then `~/hermithub-src`.

**Headless password** (only if the user asked you to set it): before the first start add
`HERMITHUB_PASSWORD=<their password>` to `.env` (Docker) or `~/.config/hermithub/env` (standalone); it seeds the
password and the setup page is skipped.

## 4. Verify and hand over

Standalone:

```bash
systemctl --user status hermithub    # Linux; macOS: launchctl print gui/$(id -u)/dev.hermithub
curl -fsS http://127.0.0.1:8787/api/health
cat ~/.hermithub/setup-token         # exists until a password is set
hermithub doctor                     # tmux/git/node/npm/gh found?
hermithub update --check             # newer release? (`hermithub update` installs it)
```

Docker:

```bash
cd ~/hermithub                       # or the folder you used
docker compose ps                      # hermithub should be "running (healthy)"
curl -fsS http://127.0.0.1:${PORT:-8787}/api/health    # {"ok":true}
cat data/.hermithub/setup-token                # exists until a password is set
```

Tell the user:

1. The setup link: `http://localhost:8787/setup?token=<token>` (or `https://<domain>/setup?token=…`).
   From another computer without a domain: `ssh -L 8787:localhost:8787 <user>@<server>` first, then open
   the localhost link.
2. Next steps in the dashboard: **Settings → AI agents → Install** (Claude Code / Codex / Gemini / OpenCode / Copilot / Qwen / Crush) →
   **Log in** (or paste an API key) → **Settings → GitHub → Log in with GitHub** → set **Git identity**.
3. Data lives in `~/.hermithub` + `~/projects` (standalone) or `<install dir>/data` (Docker); back it up.

With `--domain`, Caddy may need up to a minute for the certificate; check
`docker compose logs caddy` if HTTPS fails.

## Operate

Standalone:

| Task | Command |
|---|---|
| Update | re-run the installer. Running agent sessions keep going (tmux is not restarted). |
| Logs | `journalctl --user -u hermithub -f` (macOS: `tail -f ~/Library/Logs/hermithub.log`) |
| Restart after editing `~/.config/hermithub/env` | `systemctl --user restart hermithub` (macOS: `launchctl kickstart -k gui/$(id -u)/dev.hermithub`) |
| Lost setup link | `cat ~/.hermithub/setup-token` |
| Forgot password / lost 2FA | `hermithub set-password` / `hermithub disable-2fa` (the user should run them) |
| Uninstall | `install.sh --uninstall` (keeps data); `--uninstall --purge` also deletes settings and database — **only after explicit confirmation**. `~/projects` is never deleted. |

Docker, run from the install folder:

| Task | Command |
|---|---|
| Update | `docker compose pull && docker compose up -d` (or re-run the installer). Warn: this stops running sessions; conversations can be resumed. Source installs: `git pull && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build` |
| Logs | `docker compose logs -f hermithub` |
| Lost setup link | `cat data/.hermithub/setup-token` or `docker compose logs hermithub \| grep setup` |
| Lost authenticator (2FA) and recovery codes | `docker compose exec -u hermithub hermithub bun run disable-2fa` (the user should run it) |
| Forgot password | `docker compose exec -u hermithub hermithub bun run set-password` (interactive; the user should run it, or pass the new password as an argument only if they asked you to) |
| Shell in the container | `docker compose exec -u hermithub hermithub bash -l` — always `-u hermithub`, never as root |
| Change port / domain | edit `.env` (`HERMITHUB_PORT`, `COMPOSE_PROFILES=https`, `HERMITHUB_DOMAIN`, `PUBLIC_ORIGIN=https://<domain>`), then `docker compose up -d` |
| Stop | `docker compose down` |
| Uninstall | `docker compose down`, then — **only after explicit confirmation, it deletes all projects and logins** — `rm -rf <install dir>` |

All `.env` options: `docs/configuration.md` in the repo.

## Troubleshooting

See [references/troubleshooting.md](references/troubleshooting.md) for symptoms → causes → fixes
(container restarting, permission errors in `data/`, HTTPS/certificate problems, 403 "Origin not
allowed", agent install/login failures, sessions gone after an update).
