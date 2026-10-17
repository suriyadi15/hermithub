#!/bin/sh
# Runs as root: remap the `hub` user to PUID/PGID so files in the bind-mounted data folders belong to
# the host user, fix ownership where needed, then drop privileges and start the server.
set -eu

if [ "$(id -u)" != "0" ]; then
  # Started with `user:` already set; nothing to remap.
  exec "$@"
fi

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -g hub)" != "$PGID" ]; then groupmod -o -g "$PGID" hub; fi
if [ "$(id -u hub)" != "$PUID" ]; then usermod -o -u "$PUID" hub; fi

mkdir -p /data /home/hub/projects
# A fresh home volume is empty: give it the default dotfiles once.
for f in .bashrc .profile; do
  [ -e "/home/hub/$f" ] || cp "/etc/skel/$f" "/home/hub/$f"
done
# Only touches files that are not owned by the hub user yet (first start, or PUID changed). The projects
# folder is skipped: it can be large or shared with the host, and only its top directory needs fixing.
find /home/hub /data -path /home/hub/projects -prune -o ! -user "$PUID" -exec chown -h "$PUID:$PGID" {} + 2>/dev/null || true
[ "$(stat -c %u /home/hub/projects)" = "$PUID" ] || chown "$PUID:$PGID" /home/hub/projects

export HOME=/home/hub USER=hub LOGNAME=hub
exec setpriv --reuid="$PUID" --regid="$PGID" --init-groups -- "$@"
