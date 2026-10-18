# Installation

HermitHub can be installed two ways:

- **Standalone executable** (default): a single `hermithub` file that runs as a user service. No Docker needed.
- **Docker**: the container image with `docker compose`. Agents are isolated from the host, and built-in HTTPS
  is available with `--domain`.

## Requirements

**Standalone executable**

- Linux (x86_64 or arm64, glibc or musl/Alpine) or macOS (Intel or Apple silicon).
- `tmux` and `git`. The installer installs them with your package manager (apt, dnf, yum, pacman, zypper, apk
  or Homebrew) after asking.
- Optional: Node.js 20+ with npm for npm-distributed agents (Codex, Gemini CLI, OpenCode, Copilot, Qwen, Crush),
  and GitHub CLI (`gh`) to log in to GitHub from the dashboard. Claude Code needs neither.
- A normal user account. The installer refuses to run as root.

**Docker**

- Linux (x86_64 or arm64) or macOS with Docker.
- Docker Engine 24+ with the Compose v2 plugin (`docker compose`). The installer can install Docker on Linux.
- About 1.5 GB of disk for the image and agents, plus your projects.

Either way, 2 GB RAM or more is recommended; each agent session uses a few hundred MB.

## One-command install (standalone)

```bash
curl -fsSL https://raw.githubusercontent.com/suriyadi15/hermithub/main/install.sh | bash
```

What it does:

1. Detects the OS and CPU and installs `tmux` and `git` if they are missing (after asking).
2. Downloads `hermithub-<os>-<arch>` from the latest GitHub release, checks it against `SHA256SUMS` and
   installs it to `~/.local/bin/hermithub`.
3. Writes the settings to `~/.config/hermithub/env`.
4. Starts it as a user service. On Linux this is a systemd user unit (`hermithub.service`), and the installer
   offers `loginctl enable-linger` so the service keeps running after you log out. On macOS it is a launchd agent
   (`dev.hermithub`).
5. Prints the setup link with a one-time token.

Data goes to `~/.hermithub` (database, settings) and projects to `~/projects`. Agents, their logins, GitHub
CLI and git config are those of your user account (`~/.local`, `~/.claude`, `~/.config/gh`, `~/.gitconfig`…).

On a system without a systemd user session (Alpine/OpenRC, a container, a `su` shell), or with `--no-service`,
the installer prints the command to start HermitHub yourself.

### Options

Pass them after `bash -s --`, e.g. `curl -fsSL …/install.sh | bash -s -- --port 9000 --yes`.

| Option | Meaning |
|---|---|
| `--port N` | Port of the dashboard (default `8787`) |
| `--public` | Listen on all interfaces instead of `127.0.0.1`. Only on a private network or behind a VPN. |
| `--version TAG` | Release to install, e.g. `v0.5.0` (default: latest) |
| `--prefix PATH` | Install the executable into `PATH/bin` (default `~/.local`) |
| `--no-service` | Do not create a systemd / launchd service |
| `--uninstall` | Remove the service and the executable, keep the data |
| `--purge` | With `--uninstall`: also delete `~/.config/hermithub` and `~/.hermithub`. Projects are never deleted. |
| `--docker` | Use Docker instead (see below) |
| `--native` | Force the standalone install even if a Docker install exists in `~/hermithub` |
| `-y`, `--yes` | Do not ask questions |

Built-in HTTPS (`--domain`) is Docker-only. For the standalone install put a reverse proxy in front, see
[reverse-proxy.md](reverse-proxy.md), and set `PUBLIC_ORIGIN` / `TRUST_PROXY` in `~/.config/hermithub/env`.

### Managing the service

Linux (systemd):

```bash
systemctl --user status hermithub
journalctl --user -u hermithub -f        # logs
systemctl --user restart hermithub       # after editing ~/.config/hermithub/env
```

macOS (launchd):

```bash
tail -f ~/Library/Logs/hermithub.log
launchctl kickstart -k gui/$(id -u)/dev.hermithub
```

Agent sessions run in their own tmux server (`tmux -L hermithub`), which is not stopped when the service restarts
or updates. Running sessions keep going.

The executable has a few commands of its own:

```bash
hermithub doctor          # are tmux, git, node, npm, gh available?
hermithub version
hermithub set-password    # forgot the password
hermithub disable-2fa     # lost the authenticator and the recovery codes
```

`set-password` and `disable-2fa` use `~/.hermithub`. If you changed `DATA_DIR` in the env file, pass it along:
`DATA_DIR=/path/to/data hermithub set-password`.

### Update

HermitHub checks GitHub for a new release every 6 hours. When one is out, a dot appears on **Settings**, and
**Settings → Updates** shows it with a button to install it. From a terminal:

```bash
hermithub update --check        # is there a new release?
hermithub update                # install it and restart the service
hermithub update --version v0.5.0 -y   # a specific release, without asking
```

The update downloads the executable for your system from the release, checks it against `SHA256SUMS` and that it
starts, replaces `~/.local/bin/hermithub` and restarts the service. Settings and data are kept, and running agent
sessions keep going (they live in their own tmux server).

**Automatic updates** are off by default. Turn them on or off in **Settings → Updates**, or:

```bash
hermithub auto-update on        # install new releases on their own (checked every 6 hours)
hermithub auto-update off
hermithub auto-update status
```

`HERMITHUB_AUTO_UPDATE=1` or `0` in `~/.config/hermithub/env` overrides that switch, and `HERMITHUB_UPDATE_CHECK=0` stops
the checks altogether. Automatic installs only happen when HermitHub runs as a service, so it can be restarted.

Re-running the installer also updates (and repairs the service files).

### Installs from before the rename

HermitHub was called Project Hub up to v0.5.0. An install from then updates like any other (from the dashboard,
`project-hub update` or the installer). The first time the new version starts, it moves itself to the new names:
`~/.project-hub` → `~/.hermithub`, `~/.config/project-hub` → `~/.config/hermithub`, and the
`project-hub` service → `hermithub`. The old paths are kept as symlinks, so `project-hub` still works as a
command. Running agent sessions keep going. A Docker install in `~/project-hub` is moved to `~/hermithub` when
you re-run the installer; `docker compose pull` in the old folder keeps working too, since the image is still
published under its old name.

### Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/suriyadi15/hermithub/main/install.sh | bash -s -- --uninstall
# also delete settings and the database (projects in ~/projects stay):
curl -fsSL https://raw.githubusercontent.com/suriyadi15/hermithub/main/install.sh | bash -s -- --uninstall --purge
```

## Docker install

```bash
curl -fsSL https://raw.githubusercontent.com/suriyadi15/hermithub/main/install.sh | bash -s -- --docker
```

What it does:

1. Installs Docker if missing (Linux, after asking).
2. Creates `~/hermithub` with `docker-compose.yml`, `.env` and the `data/` folders.
3. Pulls the image and starts it.
4. Prints the setup link with a one-time token.

Once `~/hermithub/docker-compose.yml` exists, re-running the installer without options updates the Docker
install. Options for Docker, in addition to `--port`, `--public`, `--version` and `--yes`:

| Option | Meaning |
|---|---|
| `--dir PATH` | Install folder (default `~/hermithub`) |
| `--domain NAME` | Serve `https://NAME` with automatic Let's Encrypt certificates. DNS must point to the server and ports 80/443 must be reachable. |

Example: `curl -fsSL …/install.sh | bash -s -- --docker --domain hub.example.com --yes`

### Manual Docker install

```bash
mkdir hermithub && cd hermithub
curl -fsSLO https://raw.githubusercontent.com/suriyadi15/hermithub/main/docker-compose.yml
printf 'PUID=%s\nPGID=%s\n' "$(id -u)" "$(id -g)" > .env
mkdir -p data/projects
docker compose up -d
```

### Docker uninstall

```bash
cd ~/hermithub
docker compose down
# Optional — deletes all projects, logins and settings:
rm -rf ~/hermithub
```

## First login

Open the setup link printed by the installer. Lost it? Any of these show it again:

```bash
cat ~/.hermithub/setup-token                        # standalone
cat ~/hermithub/data/.hermithub/setup-token         # Docker
cd ~/hermithub && docker compose logs hermithub | grep setup
```

The token only works until a password is set. For automated installs you can skip the setup page by
putting `HERMITHUB_PASSWORD=…` in the env file (standalone) or `.env` (Docker) before the first start.

Forgot the password:

```bash
hermithub set-password                                          # standalone
docker compose exec -u hermithub hermithub bun run set-password       # Docker
```

Lost the phone with your authenticator app and have no recovery codes left:

```bash
hermithub disable-2fa                                           # standalone
docker compose exec -u hermithub hermithub bun run disable-2fa        # Docker
```
