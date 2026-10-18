# Configuration

Almost everything is configured in the dashboard (**Settings**). The rest are a few deployment options, all optional.

## Standalone executable

Settings live in `~/.config/hermithub/env` (written by the installer). Restart the service after a change:
`systemctl --user restart hermithub` on Linux, `launchctl kickstart -k gui/$(id -u)/dev.hermithub` on macOS.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Port of the dashboard |
| `HOST` | `127.0.0.1` | Address to listen on. `0.0.0.0` exposes it on all interfaces. |
| `DATA_DIR` | `~/.hermithub` | Database, setup token, tmux config |
| `PROJECTS_DIR` | `~/projects` | Where projects live |
| `PUBLIC_ORIGIN` | – | Public URL(s) behind a reverse proxy, as below |
| `TRUST_PROXY` | – | Client IP header behind a proxy, as below |
| `HUB_PASSWORD` | – | Seeds the password on first start instead of the setup page |
| `HUB_TMUX_SOCKET` | `hub` | Name of the private tmux server (`tmux -L hub ls` lists the sessions) |
| `HUB_AUTO_UPDATE` | – | `1` / `0` turns automatic updates on / off, overriding the switch in Settings and `hermithub auto-update` |
| `HUB_UPDATE_CHECK` | `1` | `0` stops the release check every 6 hours (and with it automatic updates) |
| `HUB_REPO` | `suriyadi15/hermithub` | GitHub repository releases and updates come from (for forks) |

The service starts through `~/.config/hermithub/run.sh`, which the installer regenerates. It puts `~/.local/bin`
and the usual system folders on `PATH`, and sets `NPM_CONFIG_PREFIX=~/.local` so agents installed from the dashboard
with npm need no sudo. Agents, their logins, `gh`, git config and SSH keys are your user's own.

There are no container limits. Use systemd's (`systemctl --user edit hermithub`, then `MemoryMax=6G` under `[Service]`)
if you want a cap.

## Docker

The `.env` file next to `docker-compose.yml` holds these:

| Variable | Default | Meaning |
|---|---|---|
| `PUID`, `PGID` | `1000` | Host user/group that owns `data/`. Files created from the dashboard get this owner. The installer sets them to your user. |
| `HUB_PORT` | `8787` | Host port of the dashboard |
| `HUB_BIND` | `127.0.0.1` | Host address to listen on. `0.0.0.0` exposes it on all interfaces. |
| `COMPOSE_PROFILES` | – | `https` enables the bundled Caddy reverse proxy |
| `HUB_DOMAIN` | – | Domain for the bundled Caddy (automatic Let's Encrypt) |
| `PUBLIC_ORIGIN` | – | Public URL(s), comma separated, e.g. `https://hub.example.com`. Needed when a proxy rewrites the `Host` header; also forces `Secure` cookies. |
| `TRUST_PROXY` | – | Header with the client IP for the login lockout: `1` = last `X-Forwarded-For` entry (Caddy, nginx, Traefik), `cloudflare` = `CF-Connecting-IP`. Empty: forwarded headers are ignored. Only set it when the port is reachable through that proxy alone. |
| `HUB_DATA` | `./data` | Where `home/` and `db/` live |
| `HUB_PROJECTS` | `./data/projects` | Where projects live |
| `HUB_VERSION` | `latest` | Image tag |
| `HUB_IMAGE` | `ghcr.io/suriyadi15/hermithub` | Image name (for forks) |
| `HUB_PASSWORD` | – | Seeds the password on first start instead of the setup page |

Apply changes with `docker compose up -d`.

## Data folders

| Path in the container | Host (default) | Contents |
|---|---|---|
| `/home/hub` | `data/home` | Agents (`~/.local`), their logins (`~/.claude`, `~/.codex`, `~/.gemini`, `~/.copilot`, `~/.qwen`, `~/.local/share/opencode`, `~/.local/share/crush`), `~/.config/gh`, `~/.gitconfig`, `~/.ssh` |
| `/home/hub/projects` | `data/projects` | Projects |
| `/data` | `data/db` | SQLite database |

To keep projects elsewhere, e.g. an existing folder:

```bash
echo "HUB_PROJECTS=/srv/code" >> .env
docker compose up -d
```

The folder must be owned by `PUID`/`PGID`.

## Resource limits

Agents run inside the container. To cap memory for everything in it, uncomment `mem_limit` in
`docker-compose.yml` or add a `docker-compose.override.yml`:

```yaml
services:
  hermithub:
    mem_limit: 6g
    cpus: 4
```

## Opening a shell in the container

The web terminal is the easiest. From the host:

```bash
docker compose exec -u hub hermithub bash -l
```

Always pass `-u hub`; as root you would create files the dashboard cannot change.

## Extra system packages

The image includes git, gh, tmux, ripgrep, curl, jq, Node.js and Bun. For more, build on top of it:

```dockerfile
FROM ghcr.io/suriyadi15/hermithub:latest
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && rm -rf /var/lib/apt/lists/*
```

and point `HUB_IMAGE`/`HUB_VERSION` at your image (or use `build:` in an override file). Tools installed
from the web terminal into `~/.local` (e.g. `npm i -g`, `pip install --user`, `uv`) persist without a custom image.
