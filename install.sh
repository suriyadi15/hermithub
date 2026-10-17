#!/usr/bin/env bash
# Project Hub installer / updater.
#
#   curl -fsSL https://raw.githubusercontent.com/suriyadi15/project-hub/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/suriyadi15/project-hub/main/install.sh | bash -s -- --domain hub.example.com
#
# Re-running it updates an existing install (pulls the latest image and restarts).
set -euo pipefail

REPO="${HUB_REPO:-suriyadi15/project-hub}"
BRANCH="${HUB_BRANCH:-main}"
DIR="${HUB_DIR:-$HOME/project-hub}"
DOMAIN=""
PORT=""
BIND=""
VERSION=""
YES=0

usage() {
  cat <<EOF
Usage: install.sh [options]

  --dir PATH        Install folder (default: ~/project-hub)
  --domain NAME     Serve on https://NAME with automatic Let's Encrypt certificates
                    (DNS must point here; ports 80 and 443 must be open)
  --port N          Host port for the dashboard (default: 8787)
  --public          Listen on all interfaces instead of 127.0.0.1 (only behind a firewall/VPN!)
  --version TAG     Image tag to run (default: latest)
  -y, --yes         Do not ask questions (e.g. before installing Docker)
  -h, --help        Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --public) BIND="0.0.0.0"; shift ;;
    --version) VERSION="$2"; shift 2 ;;
    -y|--yes) YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mWarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# Questions go to the terminal even when the script itself is piped into bash.
ask() {
  [[ $YES -eq 1 ]] && return 0
  [[ -r /dev/tty ]] || return 1
  local reply
  read -r -p "$1 [Y/n] " reply </dev/tty || return 1
  [[ -z "$reply" || "$reply" =~ ^[Yy] ]]
}

SUDO=""
[[ $(id -u) -ne 0 ]] && command -v sudo >/dev/null && SUDO="sudo"

# ---- Docker ----
if ! command -v docker >/dev/null; then
  case "$(uname -s)" in
    Linux)
      ask "Docker is not installed. Install it now with the official script (get.docker.com)?" ||
        die "Docker is required: https://docs.docker.com/engine/install/"
      curl -fsSL https://get.docker.com | $SUDO sh
      [[ -n "$SUDO" ]] && $SUDO usermod -aG docker "$(id -un)" || true
      ;;
    Darwin) die "Install Docker Desktop first: https://docs.docker.com/desktop/setup/install/mac-install/" ;;
    *) die "Install Docker first: https://docs.docker.com/engine/install/" ;;
  esac
fi

DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  if [[ -n "$SUDO" ]] && $SUDO docker info >/dev/null 2>&1; then
    DOCKER="$SUDO docker"
  else
    die "Cannot talk to the Docker daemon. Is it running?"
  fi
fi
$DOCKER compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (the 'docker compose' plugin)."

# ---- files ----
info "Installing into $DIR"
mkdir -p "$DIR"
cd "$DIR"
curl -fsSL "https://raw.githubusercontent.com/$REPO/$BRANCH/docker-compose.yml" -o docker-compose.yml.new
mv docker-compose.yml.new docker-compose.yml

# The hub runs as a normal user, never root: use the invoking user's ids, or 1000 when run as root.
if [[ $(id -u) -eq 0 ]]; then PUID=1000 PGID=1000; else PUID=$(id -u) PGID=$(id -g); fi

touch .env
chmod 600 .env
set_env() {
  local key="$1" value="$2"
  if grep -qE "^#? ?${key}=" .env; then
    sed -i.bak -E "s|^#? ?${key}=.*|${key}=${value}|" .env && rm -f .env.bak
  else
    echo "${key}=${value}" >> .env
  fi
}
grep -q "^PUID=" .env || set_env PUID "$PUID"
grep -q "^PGID=" .env || set_env PGID "$PGID"
[[ -n "$PORT" ]] && set_env HUB_PORT "$PORT"
[[ -n "$BIND" ]] && set_env HUB_BIND "$BIND"
[[ -n "$VERSION" ]] && set_env HUB_VERSION "$VERSION"
if [[ -n "$DOMAIN" ]]; then
  set_env COMPOSE_PROFILES https
  set_env HUB_DOMAIN "$DOMAIN"
  set_env PUBLIC_ORIGIN "https://$DOMAIN"
  set_env TRUST_PROXY 1
fi

# Create the data folders ourselves, so Docker does not create them owned by root.
PUID=$(grep -E "^PUID=" .env | cut -d= -f2)
PGID=$(grep -E "^PGID=" .env | cut -d= -f2)
mkdir -p data/home data/projects data/db
if [[ $(id -u) -eq 0 ]]; then chown -R "$PUID:$PGID" data; fi

# ---- start ----
info "Pulling the image"
$DOCKER compose pull
if $DOCKER compose ps --status running --services 2>/dev/null | grep -qx project-hub; then
  warn "Restarting stops running sessions. Conversations are kept and can be continued with Resume."
fi
$DOCKER compose up -d

HOST_PORT=$(grep -E "^HUB_PORT=" .env | cut -d= -f2 || true)
HOST_PORT="${HOST_PORT:-8787}"
info "Waiting for Project Hub to start"
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:${HOST_PORT}/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:${HOST_PORT}/api/health" >/dev/null 2>&1 ||
  die "Project Hub did not come up. Check: cd $DIR && $DOCKER compose logs project-hub"

DOMAIN_SET=$(grep -E "^HUB_DOMAIN=" .env | cut -d= -f2 || true)
if [[ -n "$DOMAIN_SET" ]]; then URL="https://$DOMAIN_SET"; else URL="http://localhost:${HOST_PORT}"; fi

echo
bold "Project Hub is running."
TOKEN=""
for _ in $(seq 1 10); do
  TOKEN=$(cat data/db/setup-token 2>/dev/null || $SUDO cat data/db/setup-token 2>/dev/null || true)
  [[ -n "$TOKEN" ]] && break
  sleep 1
done
if [[ -n "$TOKEN" ]]; then
  echo "Open this link to create your password:"
  echo
  bold "  ${URL}/setup?token=${TOKEN}"
else
  echo "Open: $URL"
fi
if [[ -z "$DOMAIN_SET" && "$(grep -E '^HUB_BIND=' .env | cut -d= -f2 || true)" != "0.0.0.0" ]]; then
  echo
  echo "The dashboard only listens on this machine. From another computer, use an SSH tunnel:"
  echo "  ssh -L ${HOST_PORT}:localhost:${HOST_PORT} $(id -un)@<this-server>"
  echo "or re-run with --domain hub.example.com for HTTPS. See docs/reverse-proxy.md."
fi
cat <<EOF

Manage it from $DIR:
  $DOCKER compose logs -f project-hub    # logs
  $DOCKER compose pull && $DOCKER compose up -d   # update (or re-run this installer)
  $DOCKER compose down                   # stop
EOF
