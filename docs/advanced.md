# Advanced

## Sharing folders with the host

By default nothing from the host is mounted. To work on host folders or reuse host logins, add a
`docker-compose.override.yml` next to `docker-compose.yml` (it is merged automatically):

```yaml
services:
  hermithub:
    volumes:
      - /home/me/code:/home/hub/projects        # host projects instead of data/projects
      - /home/me/.claude:/home/hub/.claude      # share Claude login + history with the host
      - /home/me/.claude.json:/home/hub/.claude.json
```

Notes:

- Set `PUID`/`PGID` to the owner of those folders.
- Create files before mounting them (`touch ~/.claude.json`); otherwise Docker creates a directory.
- Mount directories rather than single files when a tool rewrites the file by renaming
  (`~/.config/gh`, `~/.config/git`).
- Claude Code stores history per absolute path. Inside the container projects are at `/home/hub/projects/<name>`,
  so `--continue` only finds conversations started at that path.

## Migrating from a host install

To move an existing setup (projects in `~/projects`, Claude logged in on the host) into a self-contained install:

```bash
cd ~/hermithub && docker compose down
mkdir -p data/home data/projects
cp -a ~/projects/. data/projects/
cp -a ~/.claude data/home/ && cp ~/.claude.json data/home/
# Claude keys history by path: rename /home/<you>/projects/... to /home/hub/projects/...
cd data/home/.claude/projects
for d in -home-"$USER"-projects-*; do mv "$d" "-home-hub-projects-${d#-home-$USER-projects-}"; done
cd ~/hermithub && docker compose up -d
```

Then reconnect GitHub in Settings (or copy `~/.config/gh` to `data/home/.config/gh`).

## Running several instances

Use separate folders with different `HUB_PORT` values and set `name:` / `container_name` in an override
file so they do not clash.

## Behind a corporate proxy

Set `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` in `.env`; they are passed to the container, agent installs
and sessions.
