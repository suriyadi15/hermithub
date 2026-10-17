#!/usr/bin/env bash
# Project Hub installer / updater.
#
#   curl -fsSL https://raw.githubusercontent.com/suriyadi15/project-hub/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/suriyadi15/project-hub/main/install.sh | bash -s -- --docker
#
# By default it installs the standalone executable (Linux or macOS) and runs it as a user service.
# --docker runs the container image instead. Re-running it updates an existing install.
set -euo pipefail

REPO="${HUB_REPO:-suriyadi15/project-hub}"
BRANCH="${HUB_BRANCH:-main}"
DIR="${HUB_DIR:-$HOME/project-hub}"
PREFIX="${HUB_PREFIX:-$HOME/.local}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/project-hub"
MODE=""
DOMAIN=""
PORT=""
BIND=""
VERSION=""
YES=0
SERVICE=1
UNINSTALL=0
PURGE=0

usage() {
  cat <<EOF
Usage: install.sh [options]

  --docker          Run the Docker image instead of the standalone executable
  --native          Force the standalone executable (the default, unless a Docker install exists)
  --port N          Port for the dashboard (default: 8787)
  --public          Listen on all interfaces instead of 127.0.0.1 (only behind a firewall/VPN!)
  --version TAG     Release to install, e.g. v0.5.0 (default: latest)
  -y, --yes         Do not ask questions (e.g. before installing packages)
  -h, --help        Show this help

Standalone executable only:
  --prefix PATH     Install the executable into PATH/bin (default: ~/.local)
  --no-service      Do not set up a systemd / launchd service; print how to start it instead
  --uninstall       Stop and remove the service and the executable (keeps your data)
  --purge           With --uninstall: also delete settings and the database (~/.project-hub).
                    Your projects folder is never deleted.

Docker only:
  --dir PATH        Install folder (default: ~/project-hub)
  --domain NAME     Serve on https://NAME with automatic Let's Encrypt certificates
                    (DNS must point here; ports 80 and 443 must be open)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker) MODE=docker; shift ;;
    --native) MODE=native; shift ;;
    --dir) DIR="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --public) BIND="0.0.0.0"; shift ;;
    --version) VERSION="$2"; shift 2 ;;
    --no-service) SERVICE=0; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --purge) PURGE=1; shift ;;
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

# Sets KEY=value in the env file $1, keeping the rest. A commented-out "# KEY=" line is replaced.
set_env() {
  local file="$1" key="$2" value="$3"
  if grep -qE "^#? ?${key}=" "$file"; then
    sed -i.bak -E "s|^#? ?${key}=.*|${key}=${value}|" "$file" && rm -f "$file.bak"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

get_env() { grep -E "^$2=" "$1" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

# Prints the setup link (first install) or the URL, then how to reach a localhost-only dashboard.
print_access() {
  local url="$1" token="$2" bind="$3" port="$4"
  echo
  bold "Project Hub is running."
  if [[ -n "$token" ]]; then
    echo "Open this link to create your password:"
    echo
    bold "  ${url}/setup?token=${token}"
  else
    echo "Open: $url"
  fi
  if [[ "$url" != https://* && "$bind" != "0.0.0.0" ]]; then
    echo
    echo "The dashboard only listens on this machine. From another computer, use an SSH tunnel:"
    echo "  ssh -L ${port}:localhost:${port} $(id -un)@<this-server>"
    echo "or put it behind HTTPS. See docs/reverse-proxy.md."
  fi
}

wait_healthy() {
  local port="$1"
  info "Waiting for Project Hub to start"
  for _ in $(seq 1 60); do
    curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

# ======================================================================================================
# Standalone executable
# ======================================================================================================

BIN="$PREFIX/bin/project-hub"
ENV_FILE="$CONFIG_DIR/env"
RUNNER="$CONFIG_DIR/run.sh"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/project-hub.service"
PLIST_LABEL="dev.project-hub"
PLIST="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

has_user_systemd() {
  command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1
}

native_target() {
  local os arch
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) die "Unsupported system $(uname -s). The standalone executable runs on Linux and macOS; elsewhere use --docker." ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) die "Unsupported CPU $(uname -m). Use --docker or run from source (docs/development.md)." ;;
  esac
  # An x64 shell under Rosetta on Apple silicon: the native arm64 build is the better fit.
  if [[ $os == darwin && $arch == x64 && "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" == 1 ]]; then
    arch=arm64
  fi
  local suffix=""
  if [[ $os == linux ]] && { [[ -f /etc/alpine-release ]] || ldd --version 2>&1 | grep -qi musl; }; then
    suffix="-musl"
  fi
  echo "$os-$arch$suffix"
}

# tmux and git are required; installs them with the system package manager after asking.
native_deps() {
  local missing=() pkg
  for pkg in tmux git; do command -v "$pkg" >/dev/null || missing+=("$pkg"); done
  if [[ ${#missing[@]} -gt 0 ]]; then
    local install=""
    if command -v brew >/dev/null; then install="brew install"
    elif [[ "$(uname -s)" == Darwin ]]; then
      die "Missing: ${missing[*]}. Install Homebrew (https://brew.sh), then: brew install ${missing[*]}"
    elif command -v apt-get >/dev/null; then install="$SUDO apt-get install -y --no-install-recommends"
    elif command -v dnf >/dev/null; then install="$SUDO dnf install -y"
    elif command -v yum >/dev/null; then install="$SUDO yum install -y"
    elif command -v pacman >/dev/null; then install="$SUDO pacman -S --noconfirm --needed"
    elif command -v zypper >/dev/null; then install="$SUDO zypper --non-interactive install"
    elif command -v apk >/dev/null; then install="$SUDO apk add"
    else die "Missing: ${missing[*]}. Install them with your package manager and run this again."
    fi
    ask "Project Hub needs ${missing[*]}. Install with '${install# } ${missing[*]}'?" ||
      die "Missing: ${missing[*]}. Install them and run this again."
    if [[ $install == *apt-get* ]]; then $SUDO apt-get update -qq || true; fi
    # shellcheck disable=SC2086
    $install "${missing[@]}"
  fi
  { command -v node >/dev/null && command -v npm >/dev/null; } ||
    warn "Node.js 20+ with npm is not installed. Claude Code works without it; Codex, Gemini CLI and other npm-based agents need it."
  command -v gh >/dev/null || warn "GitHub CLI (gh) is not installed. Install it to log in to GitHub from the dashboard."
}

native_download() {
  local target="$1" base sum tmp
  if [[ -n "${HUB_DOWNLOAD_URL:-}" ]]; then base="$HUB_DOWNLOAD_URL"
  elif [[ -n "$VERSION" ]]; then base="https://github.com/$REPO/releases/download/v${VERSION#v}"
  else base="https://github.com/$REPO/releases/latest/download"
  fi
  DOWNLOAD_TMP="$(mktemp -d)"
  trap 'rm -rf "$DOWNLOAD_TMP"' EXIT
  tmp="$DOWNLOAD_TMP"
  info "Downloading project-hub-$target ${VERSION:-(latest)}"
  curl -fL --progress-bar "$base/project-hub-$target" -o "$tmp/project-hub" ||
    die "Download failed: $base/project-hub-$target"
  curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" || die "Download failed: $base/SHA256SUMS"
  sum="$(grep -E "  project-hub-$target\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
  [[ -n "$sum" ]] || die "No checksum for project-hub-$target in SHA256SUMS"
  local actual
  if command -v sha256sum >/dev/null; then actual="$(sha256sum "$tmp/project-hub" | cut -d' ' -f1)"
  else actual="$(shasum -a 256 "$tmp/project-hub" | cut -d' ' -f1)"
  fi
  [[ "$actual" == "$sum" ]] || die "Checksum mismatch for project-hub-$target (expected $sum, got $actual)"
  chmod 755 "$tmp/project-hub"
  [[ "$(uname -s)" == Darwin ]] && xattr -d com.apple.quarantine "$tmp/project-hub" 2>/dev/null || true
  mkdir -p "$PREFIX/bin"
  # Rename over the old file: a running service keeps its copy until restarted.
  mv -f "$tmp/project-hub" "$BIN.new"
  mv -f "$BIN.new" "$BIN"
}

native_config() {
  mkdir -p "$CONFIG_DIR"
  if [[ ! -f "$ENV_FILE" ]]; then
    cat > "$ENV_FILE" <<EOF
# Project Hub settings (standalone install). Restart the service after a change. See docs/configuration.md.
PORT=8787
HOST=127.0.0.1
# DATA_DIR=$HOME/.project-hub
# PROJECTS_DIR=$HOME/projects
# Public origin(s), comma separated, when served through a reverse proxy, e.g. https://hub.example.com
# PUBLIC_ORIGIN=
# Header with the client IP behind a proxy: 1 (X-Forwarded-For) or cloudflare
# TRUST_PROXY=
# Headless installs only: seed the login password instead of using the setup page.
# HUB_PASSWORD=
EOF
  fi
  chmod 600 "$ENV_FILE"
  [[ -n "$PORT" ]] && set_env "$ENV_FILE" PORT "$PORT"
  [[ -n "$BIND" ]] && set_env "$ENV_FILE" HOST "$BIND"

  # The service starts through this script so it gets a usable PATH and locale, then the env file.
  local lang="C.UTF-8"
  [[ "$(uname -s)" == Darwin ]] && lang="en_US.UTF-8"
  cat > "$RUNNER" <<EOF
#!/bin/sh
# Generated by install.sh; edit $ENV_FILE instead.
PATH="\$HOME/.local/bin:\$HOME/.bun/bin:$PREFIX/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:\$PATH"
# Agents installed with "npm install -g" from the dashboard go to ~/.local, no sudo needed.
NPM_CONFIG_PREFIX="\${NPM_CONFIG_PREFIX:-\$HOME/.local}"
LANG="\${LANG:-$lang}"
export PATH NPM_CONFIG_PREFIX LANG
set -a
. "$ENV_FILE"
set +a
cd "\$HOME"
exec "$BIN" serve
EOF
  chmod 755 "$RUNNER"
}

native_service_linux() {
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT" <<EOF
[Unit]
Description=Project Hub
After=network-online.target

[Service]
ExecStart=$RUNNER
Restart=on-failure
RestartSec=3
# Only stop the server itself: agent sessions run in a tmux server that should outlive restarts and updates.
KillMode=process

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable project-hub >/dev/null 2>&1
  if systemctl --user is-active --quiet project-hub; then
    systemctl --user restart project-hub
  else
    systemctl --user start project-hub
  fi
  # Without lingering, systemd stops user services (and the sessions) when you log out.
  if [[ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)" != yes ]]; then
    if ask "Keep Project Hub running after you log out (loginctl enable-linger, needs sudo)?"; then
      $SUDO loginctl enable-linger "$(id -un)" || warn "enable-linger failed; Project Hub stops when you log out."
    else
      warn "Project Hub stops when you log out. Later: sudo loginctl enable-linger $(id -un)"
    fi
  fi
}

native_service_macos() {
  mkdir -p "$(dirname "$PLIST")" "$HOME/Library/Logs"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$PLIST_LABEL</string>
  <key>ProgramArguments</key><array><string>$RUNNER</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <!-- Agent sessions run in a tmux server that should outlive restarts and updates. -->
  <key>AbandonProcessGroup</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/project-hub.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/project-hub.log</string>
</dict>
</plist>
EOF
  local domain
  domain="gui/$(id -u)"
  if launchctl print "$domain/$PLIST_LABEL" >/dev/null 2>&1; then
    launchctl kickstart -k "$domain/$PLIST_LABEL"
  else
    launchctl bootstrap "$domain" "$PLIST"
  fi
}

native_uninstall() {
  info "Removing Project Hub (standalone)"
  if [[ -f "$UNIT" ]]; then
    systemctl --user disable --now project-hub >/dev/null 2>&1 || true
    rm -f "$UNIT"
    systemctl --user daemon-reload 2>/dev/null || true
  fi
  if [[ -f "$PLIST" ]]; then
    launchctl bootout "gui/$(id -u)/$PLIST_LABEL" 2>/dev/null || true
    rm -f "$PLIST"
  fi
  # Agent sessions live in their own tmux server; stop it too.
  local socket
  socket="$(get_env "$ENV_FILE" HUB_TMUX_SOCKET)"
  tmux -L "${socket:-hub}" kill-server 2>/dev/null || true
  local data
  data="$(get_env "$ENV_FILE" DATA_DIR)"
  data="${data:-$HOME/.project-hub}"
  rm -f "$BIN" "$RUNNER"
  if [[ $PURGE -eq 1 ]]; then
    rm -rf "$CONFIG_DIR" "$data"
    echo "Removed the executable, the service, settings and $data. Your projects were kept."
  else
    echo "Removed the executable and the service. Kept $ENV_FILE and $data (use --purge to delete them)."
  fi
}

install_native() {
  [[ $(id -u) -ne 0 ]] || die "Run this as your normal user, not root: Project Hub gives a shell to whoever logs in.
Create a user first (e.g. adduser hub), or use --docker."
  [[ -z "$DOMAIN" ]] || die "--domain (built-in HTTPS) needs --docker. For the standalone install, put a reverse proxy
in front instead: see docs/reverse-proxy.md."

  local target
  target="$(native_target)"
  native_deps
  native_download "$target"
  native_config

  local started=0
  if [[ $SERVICE -eq 1 && "$(uname -s)" == Darwin ]]; then
    native_service_macos; started=1
  elif [[ $SERVICE -eq 1 ]] && has_user_systemd; then
    native_service_linux; started=1
  elif [[ $SERVICE -eq 1 ]]; then
    warn "No systemd user session here (containers, OpenRC, or a 'su' shell). Start Project Hub yourself (below)."
  fi
  [[ ":$PATH:" == *":$PREFIX/bin:"* ]] || warn "$PREFIX/bin is not on your PATH. Add it to run 'project-hub' directly."

  local port host data
  port="$(get_env "$ENV_FILE" PORT)"; port="${port:-8787}"
  host="$(get_env "$ENV_FILE" HOST)"
  data="$(get_env "$ENV_FILE" DATA_DIR)"; data="${data:-$HOME/.project-hub}"

  if [[ $started -eq 0 ]]; then
    echo
    bold "Installed $("$BIN" version) to $BIN."
    echo "Start it (keeps running in the background):"
    echo "  nohup $RUNNER > $CONFIG_DIR/project-hub.log 2>&1 &"
    echo "The setup link is printed in that log on the first start."
    return
  fi

  wait_healthy "$port" || {
    if [[ "$(uname -s)" == Darwin ]]; then die "Project Hub did not come up. Check ~/Library/Logs/project-hub.log"
    else die "Project Hub did not come up. Check: journalctl --user -u project-hub -n 50"
    fi
  }
  local token=""
  for _ in $(seq 1 10); do
    token="$(cat "$data/setup-token" 2>/dev/null || true)"
    [[ -n "$token" ]] && break
    sleep 1
  done
  local origin
  origin="$(get_env "$ENV_FILE" PUBLIC_ORIGIN | cut -d, -f1)"
  print_access "${origin:-http://localhost:$port}" "$token" "$host" "$port"

  echo
  echo "Settings: $ENV_FILE    Data: $data"
  if [[ "$(uname -s)" == Darwin ]]; then
    cat <<EOF
Manage it:
  tail -f ~/Library/Logs/project-hub.log                     # logs
  launchctl kickstart -k gui/\$(id -u)/$PLIST_LABEL            # restart
  launchctl bootout gui/\$(id -u)/$PLIST_LABEL                 # stop
EOF
  else
    cat <<EOF
Manage it:
  journalctl --user -u project-hub -f       # logs
  systemctl --user restart project-hub      # restart (agent sessions keep running)
  systemctl --user stop project-hub         # stop
EOF
  fi
  cat <<EOF
  project-hub set-password                  # forgot the password
  re-run this installer                     # update
EOF
}

# ======================================================================================================
# Docker
# ======================================================================================================

install_docker() {
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
  grep -q "^PUID=" .env || set_env .env PUID "$PUID"
  grep -q "^PGID=" .env || set_env .env PGID "$PGID"
  [[ -n "$PORT" ]] && set_env .env HUB_PORT "$PORT"
  [[ -n "$BIND" ]] && set_env .env HUB_BIND "$BIND"
  [[ -n "$VERSION" ]] && set_env .env HUB_VERSION "${VERSION#v}"
  if [[ -n "$DOMAIN" ]]; then
    set_env .env COMPOSE_PROFILES https
    set_env .env HUB_DOMAIN "$DOMAIN"
    set_env .env PUBLIC_ORIGIN "https://$DOMAIN"
    set_env .env TRUST_PROXY 1
  fi

  # Create the data folders ourselves, so Docker does not create them owned by root.
  PUID=$(get_env .env PUID)
  PGID=$(get_env .env PGID)
  mkdir -p data/home data/projects data/db
  if [[ $(id -u) -eq 0 ]]; then chown -R "$PUID:$PGID" data; fi

  # ---- start ----
  info "Pulling the image"
  $DOCKER compose pull
  if $DOCKER compose ps --status running --services 2>/dev/null | grep -qx project-hub; then
    warn "Restarting stops running sessions. Conversations are kept and can be continued with Resume."
  fi
  $DOCKER compose up -d

  HOST_PORT=$(get_env .env HUB_PORT)
  HOST_PORT="${HOST_PORT:-8787}"
  wait_healthy "$HOST_PORT" ||
    die "Project Hub did not come up. Check: cd $DIR && $DOCKER compose logs project-hub"

  DOMAIN_SET=$(get_env .env HUB_DOMAIN)
  if [[ -n "$DOMAIN_SET" ]]; then URL="https://$DOMAIN_SET"; else URL="http://localhost:${HOST_PORT}"; fi

  TOKEN=""
  for _ in $(seq 1 10); do
    TOKEN=$(cat data/db/setup-token 2>/dev/null || $SUDO cat data/db/setup-token 2>/dev/null || true)
    [[ -n "$TOKEN" ]] && break
    sleep 1
  done
  print_access "$URL" "$TOKEN" "$(get_env .env HUB_BIND)" "$HOST_PORT"
  cat <<EOF

Manage it from $DIR:
  $DOCKER compose logs -f project-hub    # logs
  $DOCKER compose pull && $DOCKER compose up -d   # update (or re-run this installer with --docker)
  $DOCKER compose down                   # stop
EOF
}

# ======================================================================================================

# An existing Docker install keeps being updated as one, unless --native is given.
if [[ -z "$MODE" ]]; then
  if [[ -f "$DIR/docker-compose.yml" && ! -x "$BIN" ]]; then
    info "Found a Docker install in $DIR; updating it (use --native to switch)."
    MODE=docker
  else
    MODE=native
  fi
fi

if [[ $UNINSTALL -eq 1 ]]; then
  [[ $MODE == native ]] || die "--uninstall is for the standalone install. Docker: cd $DIR && docker compose down"
  native_uninstall
elif [[ $MODE == docker ]]; then
  install_docker
else
  install_native
fi
