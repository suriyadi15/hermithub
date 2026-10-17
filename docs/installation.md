# Installation

## Requirements

- Linux (x86_64 or arm64) or macOS with Docker. Windows works through Docker Desktop + WSL 2.
- Docker Engine 24+ with the Compose v2 plugin (`docker compose`). The installer can install Docker on Linux.
- About 1.5 GB of disk for the image and agents, plus your projects. 2 GB RAM or more is recommended;
  each agent session uses a few hundred MB.

## One-command install

```bash
curl -fsSL https://raw.githubusercontent.com/suriyadi15/project-hub/main/install.sh | bash
```

What it does:

1. Installs Docker if missing (Linux, after asking).
2. Creates `~/project-hub` with `docker-compose.yml`, `.env` and the `data/` folders.
3. Pulls the image and starts it.
4. Prints the setup link with a one-time token.

Options (pass them after `bash -s --`):

| Option | Meaning |
|---|---|
| `--dir PATH` | Install folder (default `~/project-hub`) |
| `--domain NAME` | Serve `https://NAME` with automatic Let's Encrypt certificates. DNS must point to the server and ports 80/443 must be reachable. |
| `--port N` | Host port of the dashboard (default `8787`) |
| `--public` | Listen on all interfaces instead of `127.0.0.1`. Only on a private network or behind a VPN. |
| `--version TAG` | Image tag (default `latest`) |
| `-y`, `--yes` | Do not ask questions |

Example: `curl -fsSL …/install.sh | bash -s -- --domain hub.example.com --yes`

Re-running the installer updates the install and keeps your `.env` and data.

## First login

Open the setup link printed by the installer. Lost it? Any of these show it again:

```bash
cd ~/project-hub
docker compose logs project-hub | grep setup
cat data/db/setup-token
```

The token only works until a password is set. For automated installs you can skip the setup page by
putting `HUB_PASSWORD=…` in `.env` before the first start.

Forgot the password:

```bash
docker compose exec -u hub project-hub bun run set-password
```

## Manual install

```bash
mkdir project-hub && cd project-hub
curl -fsSLO https://raw.githubusercontent.com/suriyadi15/project-hub/main/docker-compose.yml
printf 'PUID=%s\nPGID=%s\n' "$(id -u)" "$(id -g)" > .env
mkdir -p data/home data/projects data/db
docker compose up -d
```

## Uninstall

```bash
cd ~/project-hub
docker compose down
# Optional — deletes all projects, logins and settings:
rm -rf ~/project-hub
```
