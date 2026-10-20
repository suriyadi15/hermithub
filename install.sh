#!/usr/bin/env bash
# HermitHub installer / updater.
#
#   curl -fsSL https://raw.githubusercontent.com/suriyadi15/hermithub/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/suriyadi15/hermithub/main/install.sh | bash -s -- --docker
#
# By default it installs the standalone executable (Linux or macOS) and runs it as a user service.
# --docker runs the container image instead. Re-running it updates an existing install.
set -euo pipefail

REPO="${HERMITHUB_REPO:-suriyadi15/hermithub}"
BRANCH="${HERMITHUB_BRANCH:-main}"
DIR="${HERMITHUB_DIR:-$HOME/hermithub}"
DIR_GIVEN=0
PREFIX="${HERMITHUB_PREFIX:-$HOME/.local}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/hermithub"
MODE=""
DOMAIN=""
PROJECTS=""
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
  --purge           With --uninstall: also delete settings and the database (~/.hermithub).
                    Your projects folder is never deleted.

Docker only:
  --dir PATH        Install folder (default: ~/hermithub)
  --domain NAME     Serve on https://NAME with automatic Let's Encrypt certificates
                    (DNS must point here; ports 80 and 443 must be open)
  --projects PATH   Keep projects in this host folder instead of <dir>/data/projects
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker) MODE=docker; shift ;;
    --native) MODE=native; shift ;;
    --dir) DIR="$2"; DIR_GIVEN=1; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --projects) PROJECTS="$2"; [[ "$PROJECTS" == /* ]] || PROJECTS="$PWD/$PROJECTS"; shift 2 ;;
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
  bold "HermitHub is running."
  if [[ -n "$token" ]]; then
    echo "Open this link to create your password:"
    echo
    bold "  ${url}/setup?token=${token}"
  else
    echo "Open: $url"
  fi
  if [[ "$url" != https://* && "$bind" != "0.0.0.0" ]]; then
    echo
    echo "The dashboard only listens on this machine. For a public https address (no account needed), run:"
    echo "  hermithub tunnel"
    echo "Or from another computer, use an SSH tunnel:"
    echo "  ssh -L ${port}:localhost:${port} $(id -un)@<this-server>"
    echo "or put it behind HTTPS. See docs/reverse-proxy.md."
  fi
}

wait_healthy() {
  local port="$1"
  info "Waiting for HermitHub to start"
  for _ in $(seq 1 60); do
    curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

# ======================================================================================================
# Standalone executable
# ======================================================================================================

BIN="$PREFIX/bin/hermithub"
ENV_FILE="$CONFIG_DIR/env"
RUNNER="$CONFIG_DIR/run.sh"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/hermithub.service"
PLIST_LABEL="dev.hermithub"
PLIST="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

# HermitHub was called Project Hub up to v0.5.0. Its standalone install used these names.
LEGACY_BIN="$PREFIX/bin/project-hub"
LEGACY_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/project-hub"
LEGACY_DATA_DIR="$HOME/.project-hub"
LEGACY_UNIT="$UNIT_DIR/project-hub.service"
LEGACY_PLIST="$HOME/Library/LaunchAgents/dev.project-hub.plist"

# Renames a folder and leaves a symlink at the old path, unless the new one exists already.
move_dir() {
  if [[ -d "$1" && ! -L "$1" && ! -e "$2" ]]; then
    mv "$1" "$2" && ln -s "$2" "$1"
    info "Moved $1 to $2"
  fi
}

# Moves a Project Hub install over to the new names: stops the old service (agent sessions keep running in
# tmux), moves the settings and data folders, and leaves the old command as a symlink to the new one.
native_migrate_legacy() {
  [[ -f "$LEGACY_UNIT" || -f "$LEGACY_PLIST" || ( -e "$LEGACY_BIN" && ! -L "$LEGACY_BIN" ) || \
     ( -d "$LEGACY_CONFIG_DIR" && ! -L "$LEGACY_CONFIG_DIR" ) ]] || return 0
  info "Moving the Project Hub install to the new name, HermitHub"
  if [[ -f "$LEGACY_UNIT" ]]; then
    systemctl --user disable --now project-hub >/dev/null 2>&1 || true
    rm -f "$LEGACY_UNIT"
    systemctl --user daemon-reload 2>/dev/null || true
  fi
  if [[ -f "$LEGACY_PLIST" ]]; then
    launchctl bootout "gui/$(id -u)/dev.project-hub" 2>/dev/null || true
    rm -f "$LEGACY_PLIST"
  fi
  move_dir "$LEGACY_CONFIG_DIR" "$CONFIG_DIR"
  [[ -n "$(get_env "$ENV_FILE" DATA_DIR)" ]] || move_dir "$LEGACY_DATA_DIR" "$HOME/.hermithub"
  if [[ -f "$ENV_FILE" ]]; then
    sed -i.bak -e 's|Project Hub|HermitHub|' -e "s|$LEGACY_DATA_DIR\$|$HOME/.hermithub|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  fi
  if [[ -e "$LEGACY_BIN" && ! -L "$LEGACY_BIN" ]]; then
    rm -f "$LEGACY_BIN"
    ln -s hermithub "$LEGACY_BIN"
  fi
}

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
    ask "HermitHub needs ${missing[*]}. Install with '${install# } ${missing[*]}'?" ||
      die "Missing: ${missing[*]}. Install them and run this again."
    if [[ $install == *apt-get* ]]; then $SUDO apt-get update -qq || true; fi
    # shellcheck disable=SC2086
    $install "${missing[@]}"
  fi
  { command -v node >/dev/null && command -v npm >/dev/null; } ||
    warn "Node.js 20+ with npm is not installed. Claude Code works without it; Codex, Gemini CLI and other npm-based agents need it."
  command -v rg >/dev/null || warn "ripgrep (rg) is not installed. Search works without it but is faster with it."
  command -v gh >/dev/null || warn "GitHub CLI (gh) is not installed. Install it to log in to GitHub from the dashboard."
}

native_download() {
  local target="$1" base sum tmp
  if [[ -n "${HERMITHUB_DOWNLOAD_URL:-}" ]]; then base="$HERMITHUB_DOWNLOAD_URL"
  elif [[ -n "$VERSION" ]]; then base="https://github.com/$REPO/releases/download/v${VERSION#v}"
  else base="https://github.com/$REPO/releases/latest/download"
  fi
  DOWNLOAD_TMP="$(mktemp -d)"
  trap 'rm -rf "$DOWNLOAD_TMP"' EXIT
  tmp="$DOWNLOAD_TMP"
  # Releases up to v0.5.0 (as Project Hub) only have project-hub-<target>.
  local file="hermithub-$target"
  info "Downloading $file ${VERSION:-(latest)}"
  if ! curl -fsSL "$base/$file" -o /dev/null --range 0-0 2>/dev/null; then file="project-hub-$target"; fi
  curl -fL --progress-bar "$base/$file" -o "$tmp/hermithub" || die "Download failed: $base/$file"
  curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" || die "Download failed: $base/SHA256SUMS"
  sum="$(grep -E "  $file\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
  [[ -n "$sum" ]] || die "No checksum for $file in SHA256SUMS"
  local actual
  if command -v sha256sum >/dev/null; then actual="$(sha256sum "$tmp/hermithub" | cut -d' ' -f1)"
  else actual="$(shasum -a 256 "$tmp/hermithub" | cut -d' ' -f1)"
  fi
  [[ "$actual" == "$sum" ]] || die "Checksum mismatch for $file (expected $sum, got $actual)"
  chmod 755 "$tmp/hermithub"
  [[ "$(uname -s)" == Darwin ]] && xattr -d com.apple.quarantine "$tmp/hermithub" 2>/dev/null || true
  mkdir -p "$PREFIX/bin"
  # Rename over the old file: a running service keeps its copy until restarted.
  mv -f "$tmp/hermithub" "$BIN.new"
  mv -f "$BIN.new" "$BIN"
}

native_config() {
  mkdir -p "$CONFIG_DIR"
  if [[ ! -f "$ENV_FILE" ]]; then
    cat > "$ENV_FILE" <<EOF
# HermitHub settings (standalone install). Restart the service after a change. See docs/configuration.md.
PORT=8787
HOST=127.0.0.1
# DATA_DIR=$HOME/.hermithub
# PROJECTS_DIR=$HOME/projects
# Public origin(s), comma separated, when served through a reverse proxy, e.g. https://hub.example.com
# PUBLIC_ORIGIN=
# Header with the client IP behind a proxy: 1 (X-Forwarded-For) or cloudflare
# TRUST_PROXY=
# Headless installs only: seed the login password instead of using the setup page.
# HERMITHUB_PASSWORD=
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
Description=HermitHub
After=network-online.target

[Service]
ExecStart=$RUNNER
# Tells HermitHub that systemd restarts it, so it can restart itself after an update.
Environment=HERMITHUB_SERVICE=systemd
Restart=on-failure
RestartSec=3
# Only stop the server itself: agent sessions run in a tmux server that should outlive restarts and updates.
KillMode=process

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable hermithub >/dev/null 2>&1
  if systemctl --user is-active --quiet hermithub; then
    systemctl --user restart hermithub
  else
    systemctl --user start hermithub
  fi
  # Without lingering, systemd stops user services (and the sessions) when you log out.
  if [[ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)" != yes ]]; then
    if ask "Keep HermitHub running after you log out (loginctl enable-linger, needs sudo)?"; then
      $SUDO loginctl enable-linger "$(id -un)" || warn "enable-linger failed; HermitHub stops when you log out."
    else
      warn "HermitHub stops when you log out. Later: sudo loginctl enable-linger $(id -un)"
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
  <key>EnvironmentVariables</key><dict><key>HERMITHUB_SERVICE</key><string>launchd</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <!-- Agent sessions run in a tmux server that should outlive restarts and updates. -->
  <key>AbandonProcessGroup</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/hermithub.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/hermithub.log</string>
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
  native_migrate_legacy
  info "Removing HermitHub (standalone)"
  if [[ -f "$UNIT" ]]; then
    systemctl --user disable --now hermithub >/dev/null 2>&1 || true
    rm -f "$UNIT"
    systemctl --user daemon-reload 2>/dev/null || true
  fi
  if [[ -f "$PLIST" ]]; then
    launchctl bootout "gui/$(id -u)/$PLIST_LABEL" 2>/dev/null || true
    rm -f "$PLIST"
  fi
  # Agent sessions live in their own tmux server; stop it too.
  local socket
  socket="$(get_env "$ENV_FILE" HERMITHUB_TMUX_SOCKET)"
  tmux -L "${socket:-hermithub}" kill-server 2>/dev/null || true
  local data
  data="$(get_env "$ENV_FILE" DATA_DIR)"
  data="${data:-$HOME/.hermithub}"
  rm -f "$BIN" "$RUNNER"
  # Symlinks left by the move from the old name.
  [[ -L "$LEGACY_BIN" ]] && rm -f "$LEGACY_BIN"
  if [[ $PURGE -eq 1 ]]; then
    rm -rf "$CONFIG_DIR" "$data"
    for old in "$LEGACY_CONFIG_DIR" "$LEGACY_DATA_DIR"; do [[ -L "$old" ]] && rm -f "$old"; done
    echo "Removed the executable, the service, settings and $data. Your projects were kept."
  else
    echo "Removed the executable and the service. Kept $ENV_FILE and $data (use --purge to delete them)."
  fi
}

install_native() {
  [[ $(id -u) -ne 0 ]] || die "Run this as your normal user, not root: HermitHub gives a shell to whoever logs in.
Create a user first (e.g. adduser hermithub), or use --docker."
  [[ -z "$DOMAIN" ]] || die "--domain (built-in HTTPS) needs --docker. For the standalone install, put a reverse proxy
in front instead: see docs/reverse-proxy.md."
  [[ -z "$PROJECTS" ]] || die "--projects needs --docker. For the standalone install, set PROJECTS_DIR in
$CONFIG_DIR/env instead."

  local target
  target="$(native_target)"
  native_deps
  native_download "$target"
  native_migrate_legacy
  native_config

  local started=0
  if [[ $SERVICE -eq 1 && "$(uname -s)" == Darwin ]]; then
    native_service_macos; started=1
  elif [[ $SERVICE -eq 1 ]] && has_user_systemd; then
    native_service_linux; started=1
  elif [[ $SERVICE -eq 1 ]]; then
    warn "No systemd user session here (containers, OpenRC, or a 'su' shell). Start HermitHub yourself (below)."
  fi
  [[ ":$PATH:" == *":$PREFIX/bin:"* ]] || warn "$PREFIX/bin is not on your PATH. Add it to run 'hermithub' directly."

  local port host data
  port="$(get_env "$ENV_FILE" PORT)"; port="${port:-8787}"
  host="$(get_env "$ENV_FILE" HOST)"
  data="$(get_env "$ENV_FILE" DATA_DIR)"; data="${data:-$HOME/.hermithub}"

  if [[ $started -eq 0 ]]; then
    echo
    bold "Installed $("$BIN" version) to $BIN."
    echo "Start it (keeps running in the background):"
    echo "  nohup $RUNNER > $CONFIG_DIR/hermithub.log 2>&1 &"
    echo "The setup link is printed in that log on the first start."
    return
  fi

  wait_healthy "$port" || {
    if [[ "$(uname -s)" == Darwin ]]; then die "HermitHub did not come up. Check ~/Library/Logs/hermithub.log"
    else die "HermitHub did not come up. Check: journalctl --user -u hermithub -n 50"
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
  tail -f ~/Library/Logs/hermithub.log                     # logs
  launchctl kickstart -k gui/\$(id -u)/$PLIST_LABEL            # restart
  launchctl bootout gui/\$(id -u)/$PLIST_LABEL                 # stop
EOF
  else
    cat <<EOF
Manage it:
  journalctl --user -u hermithub -f       # logs
  systemctl --user restart hermithub      # restart (agent sessions keep running)
  systemctl --user stop hermithub         # stop
EOF
  fi
  cat <<EOF
  hermithub set-password                  # forgot the password
  hermithub update                        # update now (or from Settings → Updates)
  hermithub auto-update on                # install new releases automatically
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
  if [[ -n "$LEGACY_DOCKER_DIR" ]]; then
    info "Moving $LEGACY_DOCKER_DIR to $DIR (Project Hub is now HermitHub)"
    (cd "$LEGACY_DOCKER_DIR" && $DOCKER compose down)
    mv "$LEGACY_DOCKER_DIR" "$DIR"
  fi

  info "Installing into $DIR"
  mkdir -p "$DIR"
  cd "$DIR"
  curl -fsSL "https://raw.githubusercontent.com/$REPO/$BRANCH/docker-compose.yml" -o docker-compose.yml.new
  mv docker-compose.yml.new docker-compose.yml

  # HermitHub runs as a normal user, never root: use the invoking user's ids, or 1000 when run as root.
  if [[ $(id -u) -eq 0 ]]; then PUID=1000 PGID=1000; else PUID=$(id -u) PGID=$(id -g); fi

  touch .env
  chmod 600 .env
  grep -q "^PUID=" .env || set_env .env PUID "$PUID"
  grep -q "^PGID=" .env || set_env .env PGID "$PGID"
  [[ -n "$PORT" ]] && set_env .env HERMITHUB_PORT "$PORT"
  [[ -n "$BIND" ]] && set_env .env HERMITHUB_BIND "$BIND"
  [[ -n "$VERSION" ]] && set_env .env HERMITHUB_VERSION "${VERSION#v}"
  [[ -n "$PROJECTS" ]] && set_env .env HERMITHUB_PROJECTS "$PROJECTS"
  if [[ -n "$DOMAIN" ]]; then
    set_env .env COMPOSE_PROFILES https
    set_env .env HERMITHUB_DOMAIN "$DOMAIN"
    set_env .env PUBLIC_ORIGIN "https://$DOMAIN"
    set_env .env TRUST_PROXY 1
  fi

  # Create the data folders ourselves, so Docker does not create them owned by root. data/ becomes the
  # home folder of the container user.
  PUID=$(get_env .env PUID)
  PGID=$(get_env .env PGID)
  PROJECTS_SET=$(get_env .env HERMITHUB_PROJECTS)
  mkdir -p data/projects caddy ${PROJECTS_SET:+"$PROJECTS_SET"}
  if [[ $(id -u) -eq 0 ]]; then
    chown -R "$PUID:$PGID" data
    [[ -z "$PROJECTS_SET" ]] || chown "$PUID:$PGID" "$PROJECTS_SET"
  fi

  # ---- start ----
  info "Pulling the image"
  $DOCKER compose pull
  if $DOCKER compose ps --status running --services 2>/dev/null | grep -qx hermithub; then
    warn "Restarting stops running sessions. Conversations are kept and can be continued with Resume."
  fi
  $DOCKER compose up -d

  HOST_PORT=$(get_env .env HERMITHUB_PORT)
  HOST_PORT="${HOST_PORT:-8787}"
  wait_healthy "$HOST_PORT" ||
    die "HermitHub did not come up. Check: cd $DIR && $DOCKER compose logs hermithub"

  DOMAIN_SET=$(get_env .env HERMITHUB_DOMAIN)
  if [[ -n "$DOMAIN_SET" ]]; then URL="https://$DOMAIN_SET"; else URL="http://localhost:${HOST_PORT}"; fi

  TOKEN=""
  for _ in $(seq 1 10); do
    TOKEN=$(cat data/.hermithub/setup-token 2>/dev/null || $SUDO cat data/.hermithub/setup-token 2>/dev/null || true)
    [[ -n "$TOKEN" ]] && break
    sleep 1
  done
  print_access "$URL" "$TOKEN" "$(get_env .env HERMITHUB_BIND)" "$HOST_PORT"
  cat <<EOF

Manage it from $DIR:
  $DOCKER compose logs -f hermithub    # logs
  $DOCKER compose pull && $DOCKER compose up -d   # update (or re-run this installer with --docker)
  $DOCKER compose down                   # stop
EOF
}

# ======================================================================================================

# A Docker install from before the rename lives in ~/project-hub; it is moved to the new folder.
LEGACY_DOCKER_DIR=""
if [[ -z "${HERMITHUB_DIR:-}" && $DIR_GIVEN -eq 0 && ! -e "$DIR" && -f "$HOME/project-hub/docker-compose.yml" ]]; then
  LEGACY_DOCKER_DIR="$HOME/project-hub"
fi

# An existing Docker install keeps being updated as one, unless --native is given.
if [[ -z "$MODE" ]]; then
  if [[ ( -f "$DIR/docker-compose.yml" || -n "$LEGACY_DOCKER_DIR" ) && ! -x "$BIN" && ! -x "$LEGACY_BIN" ]]; then
    info "Found a Docker install in ${LEGACY_DOCKER_DIR:-$DIR}; updating it (use --native to switch)."
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
