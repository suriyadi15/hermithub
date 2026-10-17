# Configuration

Almost everything is configured in the dashboard (**Settings**). The `.env` file next to
`docker-compose.yml` only holds a few deployment options; all are optional.

| Variable | Default | Meaning |
|---|---|---|
| `PUID`, `PGID` | `1000` | Host user/group that owns `data/`. Files created from the dashboard get this owner. The installer sets them to your user. |
| `HUB_PORT` | `8787` | Host port of the dashboard |
| `HUB_BIND` | `127.0.0.1` | Host address to listen on. `0.0.0.0` exposes it on all interfaces. |
| `COMPOSE_PROFILES` | – | `https` enables the bundled Caddy reverse proxy |
| `HUB_DOMAIN` | – | Domain for the bundled Caddy (automatic Let's Encrypt) |
| `PUBLIC_ORIGIN` | – | Public URL(s), comma separated, e.g. `https://hub.example.com`. Needed when a proxy rewrites the `Host` header; also forces `Secure` cookies. |
| `HUB_DATA` | `./data` | Where `home/` and `db/` live |
| `HUB_PROJECTS` | `./data/projects` | Where projects live |
| `HUB_VERSION` | `latest` | Image tag |
| `HUB_IMAGE` | `ghcr.io/suriyadi15/project-hub` | Image name (for forks) |
| `HUB_PASSWORD` | – | Seeds the password on first start instead of the setup page |

Apply changes with `docker compose up -d`.

## Data folders

| Path in the container | Host (default) | Contents |
|---|---|---|
| `/home/hub` | `data/home` | Agents (`~/.local`), their logins (`~/.claude`, `~/.codex`, `~/.gemini`), `~/.config/gh`, `~/.gitconfig`, `~/.ssh` |
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
  project-hub:
    mem_limit: 6g
    cpus: 4
```

## Opening a shell in the container

The web terminal is the easiest. From the host:

```bash
docker compose exec -u hub project-hub bash -l
```

Always pass `-u hub`; as root you would create files the dashboard cannot change.

## Extra system packages

The image includes git, gh, tmux, ripgrep, curl, jq, Node.js and Bun. For more, build on top of it:

```dockerfile
FROM ghcr.io/suriyadi15/project-hub:latest
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && rm -rf /var/lib/apt/lists/*
```

and point `HUB_IMAGE`/`HUB_VERSION` at your image (or use `build:` in an override file). Tools installed
from the web terminal into `~/.local` (e.g. `npm i -g`, `pip install --user`, `uv`) persist without a custom image.
