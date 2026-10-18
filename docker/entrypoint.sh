#!/bin/sh
# Runs as root: remap the `hermithub` user to PUID/PGID so files in the mounted home belong to the host
# user, fix ownership where needed, then drop privileges and start the server.
set -eu

if [ "$(id -u)" != "0" ]; then
  # Started with `user:` already set; nothing to remap.
  exec "$@"
fi

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
HOME_DIR=/home/hermithub

if [ "$(id -g hermithub)" != "$PGID" ]; then groupmod -o -g "$PGID" hermithub; fi
if [ "$(id -u hermithub)" != "$PUID" ]; then usermod -o -u "$PUID" hermithub; fi

mkdir -p "$HOME_DIR/projects"
# A fresh home volume is empty: give it the default dotfiles once.
for f in .bashrc .profile; do
  [ -e "$HOME_DIR/$f" ] || cp "/etc/skel/$f" "$HOME_DIR/$f"
done
# Only touches files that are not owned by the hermithub user yet (first start, or PUID changed). The
# projects folder is skipped: it can be large or a separate mount shared with the host, and only its top
# directory needs fixing.
find "$HOME_DIR" -path "$HOME_DIR/projects" -prune -o ! -user "$PUID" -exec chown -h "$PUID:$PGID" {} + 2>/dev/null || true
[ "$(stat -c %u "$HOME_DIR/projects")" = "$PUID" ] || chown "$PUID:$PGID" "$HOME_DIR/projects"

export HOME="$HOME_DIR" USER=hermithub LOGNAME=hermithub
exec setpriv --reuid="$PUID" --regid="$PGID" --init-groups -- "$@"
