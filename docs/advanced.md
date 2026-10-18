# Advanced

## Sharing folders with the host

By default nothing from the host is mounted. For projects in a host folder, set `HERMITHUB_PROJECTS` (see
[Configuration](configuration.md#data-folders)). To reuse host logins or mount other folders, add a
`docker-compose.override.yml` next to `docker-compose.yml` (it is merged automatically):

```yaml
services:
  hermithub:
    volumes:
      - /home/me/.claude:/home/hermithub/.claude      # share Claude login + history with the host
      - /home/me/.claude.json:/home/hermithub/.claude.json
```

Notes:

- Set `PUID`/`PGID` to the owner of those folders.
- Create files before mounting them (`touch ~/.claude.json`); otherwise Docker creates a directory.
- Mount directories rather than single files when a tool rewrites the file by renaming
  (`~/.config/gh`, `~/.config/git`).
- Claude Code stores history per absolute path. Inside the container projects are at `/home/hermithub/projects/<name>`,
  so `--continue` only finds conversations started at that path.

## Migrating from a host install

To move an existing setup (projects in `~/projects`, Claude logged in on the host) into a self-contained install:

```bash
cd ~/hermithub && docker compose down
mkdir -p data/projects
cp -a ~/projects/. data/projects/
cp -a ~/.claude data/ && cp ~/.claude.json data/
# Claude keys history by path: rename /home/<you>/projects/... to /home/hermithub/projects/...
cd data/.claude/projects
for d in -home-"$USER"-projects-*; do mv "$d" "-home-hermithub-projects-${d#-home-$USER-projects-}"; done
cd ~/hermithub && docker compose up -d
```

Then reconnect GitHub in Settings (or copy `~/.config/gh` to `data/.config/gh`).

## Running several instances

Use separate folders with different `HERMITHUB_PORT` values and set `name:` / `container_name` in an override
file so they do not clash.

## Behind a corporate proxy

Set `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` in `.env`; they are passed to the container, agent installs
and sessions.
