# Project Hub troubleshooting

Run commands from the install folder. Start with:

```bash
docker compose ps
docker compose logs --tail 100 project-hub
```

## Container keeps restarting / unhealthy

| Log shows | Cause | Fix |
|---|---|---|
| `EACCES` / `permission denied` on `/data` or `/home/hub` | `data/` owned by another user than `PUID`/`PGID` | `grep -E 'PUID|PGID' .env` and `ls -ln data`; fix with `sudo chown -R <PUID>:<PGID> data/home data/db`, then `docker compose up -d` |
| `address already in use` | Port taken | Set another `HUB_PORT` in `.env`, `docker compose up -d` |
| `exec format error` | Image for another CPU architecture | Pull again (`docker compose pull`); images are amd64 + arm64. On other architectures build from source. |
| nothing useful, exits immediately | Corrupt or old compose file | Re-run the installer (it refreshes `docker-compose.yml`) |

Never fix permissions by running the hub as root (`PUID=0`).

## Image pull fails

`manifest unknown`, `not found` or `denied` for `ghcr.io/suriyadi15/project-hub`: no release image is
available to you yet. Use the build-from-source steps in SKILL.md. Behind a proxy: set `HTTP_PROXY` /
`HTTPS_PROXY` for the Docker daemon, not only the shell.

## Can't open the dashboard

- `curl -fsS http://127.0.0.1:8787/api/health` works on the server but not from your laptop: expected —
  it listens on localhost only. Use `ssh -L 8787:localhost:8787 user@server`, `--domain`, or a tunnel.
- **HTTPS with `--domain` fails**: `docker compose logs caddy`.
  - `NXDOMAIN` / `no such host` / challenge failed → DNS does not point to this server yet, or a firewall
    / cloud security group blocks 80/443. Fix DNS/firewall, then `docker compose restart caddy`.
  - `address already in use` on 80/443 → another web server (nginx, apache, another Caddy) runs on the host.
    Either stop it or drop `COMPOSE_PROFILES=https` and proxy from the existing server (docs/reverse-proxy.md).
- **"Origin not allowed" (403) or login loops behind your own proxy**: set
  `PUBLIC_ORIGIN=https://<public host>` in `.env` and make sure the proxy forwards `Host`, `Upgrade` and
  `Connection` headers (WebSockets). `docker compose up -d`.
- **Terminal stays "Connecting…"**: the proxy does not forward WebSockets for `/ws/`.

## Setup / login

- Setup page says "Invalid setup token": the token changes on every container start while no password
  exists. Read the current one: `cat data/db/setup-token`.
- "Setup is already done": a password exists. Use the login page, or reset it:
  `docker compose exec -u hub project-hub bun run set-password`.
- "Too many attempts": wait 15 minutes or restart the container.

## Agents (Settings → AI agents)

- **Install fails with network errors**: the container needs outbound HTTPS to `claude.ai`,
  `registry.npmjs.org` and the vendors' APIs.
- **Codex login does nothing**: device-code login must be enabled in the ChatGPT account's security
  settings, or use an API key.
- **Gemini keeps asking how to authenticate**: choose "Login with Google" in the login terminal, or save a
  Gemini API key in Settings.
- **Codex commands fail with sandbox errors**: Codex's sandbox does not work in many containers; start the
  session with the `yolo` mode.
- **"X is not installed yet"** when starting a session: install it in Settings first.

## Sessions disappeared

Recreating the container (update, `.env` change + `docker compose up -d`) ends all tmux sessions.
Conversations are kept in `data/home`; on the project page use **Resume** / "Continue the last conversation".

## GitHub

- Clone of a private repo fails: Settings → GitHub must show "Connected". Re-run **Log in with GitHub**.
- Push rejected for workflow files: the token needs the `workflow` scope (a new login grants it).

## Collect info for a bug report

```bash
docker compose version; docker compose images
docker compose logs --tail 200 project-hub   # remove tokens/keys before sharing
```

Issues: https://github.com/suriyadi15/project-hub/issues
