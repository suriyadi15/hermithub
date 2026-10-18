# HermitHub

A self-hosted web dashboard for your code projects and AI coding agents — **Claude Code**, **Codex CLI**,
**Gemini CLI**, **OpenCode**, **GitHub Copilot CLI** and more — installed as a single executable on Linux or macOS,
or as a Docker container. Open it from any browser (phone included), start agent sessions in your projects, and close
the tab: sessions keep running on the server.

Agents, their logins, GitHub access and git settings are all set up from the dashboard.

## Features

- **Projects**: create (empty folder, `git init` or `git clone`), rename, move to trash, restore.
- **Agent sessions**, several at once per project, in a web terminal (tmux under the hood):
  - Claude Code, Codex CLI, Gemini CLI, OpenCode, GitHub Copilot CLI, Qwen Code, Crush — pick a permission
    mode per session, continue the last conversation.
  - **Claude Remote Control**: drive a session from claude.ai/code or the Claude mobile app.
  - Plain **bash** terminal in the project folder.
- **Settings in the browser**: install / update / log in to each agent, or paste an API key; log in to
  GitHub (device code or token); git name and email; SSH key for other git servers.
- **Monitoring**: active / waiting / exited status, CPU and RAM per session, last output lines, server load.
- **Files**: file tree, Monaco editor (Ctrl+S), quick open (Ctrl+P), search across files, upload / download.
- **Git**: stage, commit, push, pull, branches, stash, diffs, recent commits.
- **Parallel tasks with git worktrees**: give each task its own folder and branch, run an agent in each,
  switch the file tree and Git panel between them, then merge back and clean up.
- **Mobile friendly**: bottom navigation, a text box for long prompts, sticky Ctrl, arrow keys, history scrolling.

## How it works

The browser talks to a small Bun server, and every agent runs inside a tmux session on that server, so it keeps
running when you close the tab. The server runs either as a standalone executable (a user service on your machine)
or in a Docker container; the diagram shows the Docker setup.

![HermitHub architecture](https://mermaid.ink/img/Zmxvd2NoYXJ0IFRCCiAgICB1c2VyWyJCcm93c2VyIC8gcGhvbmU8YnIvPlJlYWN0IFVJIMK3IHh0ZXJtLmpzIMK3IE1vbmFjbyJdCiAgICBjYWRkeVsiQ2FkZHkgKG9wdGlvbmFsKTxici8-SFRUUFMgZm9yIC0tZG9tYWluIl0KCiAgICBzdWJncmFwaCBjb250YWluZXJbIkRvY2tlciBjb250YWluZXIiXQogICAgICAgIHNlcnZlclsiSGVybWl0SHViIHNlcnZlciDCtyBCdW4gKyBFbHlzaWEgwrcgOjg3ODc8YnIvPnBhc3N3b3JkIGxvZ2luICsgb3JpZ2luIGNoZWNrIl0KICAgICAgICBhcGlbIlJFU1QgL2FwaS8qPGJyLz5wcm9qZWN0cyDCtyBmaWxlcyDCtyBnaXQgwrcgc2VhcmNoPGJyLz5zZXNzaW9ucyDCtyBhZ2VudHMgwrcgc2V0dGluZ3MiXQogICAgICAgIHdzWyJXZWJTb2NrZXQgL3dzL3Rlcm0vOm5hbWU8YnIvPmxpdmUgdGVybWluYWwiXQogICAgICAgIHRtdXhbInRtdXggKHByaXZhdGUgc29ja2V0KTxici8-b25lIHRtdXggc2Vzc2lvbiBwZXIgYWdlbnQgc2Vzc2lvbiJdCiAgICAgICAgYWdlbnRzWyJDbGF1ZGUgQ29kZSDCtyBDb2RleCBDTEk8YnIvPkdlbWluaSBDTEkgwrcgYmFzaCJdCiAgICBlbmQKCiAgICBzdWJncmFwaCBkYXRhWyIuL2RhdGEgb24gdGhlIGhvc3QiXQogICAgICAgIHByb2plY3RzWygicHJvamVjdHMvPGJyLz55b3VyIGNvZGUiKV0KICAgICAgICBob21lWygiaG9tZS88YnIvPmFnZW50cywgbG9naW5zLDxici8-Z2l0ICYgU1NIIGNvbmZpZyIpXQogICAgICAgIGRiWygiZGIvPGJyLz5TUUxpdGUiKV0KICAgIGVuZAoKICAgIGNsb3VkWyJBSSBwcm92aWRlcnMgwrcgR2l0SHViPGJyLz5vdGhlciBnaXQgc2VydmVycyJdCgogICAgdXNlciAtLSAiSFRUUFMiIC0tPiBjYWRkeQogICAgY2FkZHkgLS0-IHNlcnZlcgogICAgdXNlciAtLiAibG9jYWxob3N0IC8gdHVubmVsIiAuLT4gc2VydmVyCiAgICBzZXJ2ZXIgLS0-IGFwaQogICAgc2VydmVyIC0tPiB3cwogICAgYXBpIC0tICJzdGFydCAvIHN0b3AgLyBzdGF0dXMiIC0tPiB0bXV4CiAgICB3cyAtLSAiYXR0YWNoIChQVFkpIiAtLT4gdG11eAogICAgdG11eCAtLT4gYWdlbnRzCiAgICBhcGkgLS0-IGRiCiAgICBhcGkgLS0-IHByb2plY3RzCiAgICBhZ2VudHMgLS0-IHByb2plY3RzCiAgICBhZ2VudHMgLS0-IGhvbWUKICAgIGFnZW50cyAtLT4gY2xvdWQK?type=png&bgColor=!white&width=1600)

What happens when you start a session and come back later:

![Life of an agent session](https://mermaid.ink/img/c2VxdWVuY2VEaWFncmFtCiAgICBhY3RvciBZb3UKICAgIHBhcnRpY2lwYW50IFVJIGFzIEJyb3dzZXIKICAgIHBhcnRpY2lwYW50IFMgYXMgU2VydmVyCiAgICBwYXJ0aWNpcGFudCBUIGFzIHRtdXgKICAgIHBhcnRpY2lwYW50IEEgYXMgQWdlbnQgQ0xJCgogICAgWW91LT4-VUk6IE5ldyBzZXNzaW9uIChhZ2VudCwgcGVybWlzc2lvbiBtb2RlKQogICAgVUktPj5TOiBQT1NUIC9hcGkvc2Vzc2lvbnMKICAgIFMtPj5UOiBuZXctc2Vzc2lvbiBpbiB0aGUgcHJvamVjdCBmb2xkZXIKICAgIFQtPj5BOiBsYXVuY2ggY2xhdWRlIC8gY29kZXggLyBnZW1pbmkgLyBiYXNoCiAgICBVSS0-PlM6IG9wZW4gV2ViU29ja2V0IC93cy90ZXJtLzpuYW1lCiAgICBTLT4-VDogYXR0YWNoIHRocm91Z2ggYSBQVFkKICAgIGxvb3AgV2hpbGUgdGhlIHRhYiBpcyBvcGVuCiAgICAgICAgWW91LT4-VUk6IHR5cGUKICAgICAgICBVSS0-PlM6IGtleXN0cm9rZXMKICAgICAgICBTLT4-VDogaW5wdXQKICAgICAgICBBLS0-PlQ6IG91dHB1dAogICAgICAgIFQtLT4-VUk6IHRlcm1pbmFsIG91dHB1dCAoc3RyZWFtZWQpCiAgICBlbmQKICAgIFlvdS0-PlVJOiBjbG9zZSB0aGUgdGFiCiAgICBVSS0teFM6IFdlYlNvY2tldCBjbG9zZWQKICAgIE5vdGUgb3ZlciBULEE6IFRoZSBzZXNzaW9uIGtlZXBzIHJ1bm5pbmcgb24gdGhlIHNlcnZlcgogICAgVUktPj5TOiBkYXNoYm9hcmQgcG9sbHMgc3RhdHVzLCBDUFUgLyBSQU0sIGxhc3QgbGluZXMKICAgIFlvdS0-PlVJOiBvcGVuIHRoZSBzZXNzaW9uIGFnYWluCiAgICBVSS0-PlM6IG9wZW4gV2ViU29ja2V0CiAgICBTLT4-VDogYXR0YWNoIHRvIHRoZSBzYW1lIHNlc3Npb24K?type=png&bgColor=!white&width=1600)

- **Two ways to run it.** The standalone executable needs only tmux and git and uses your own user account.
  The Docker image keeps agents in a container, and everything in `./data`.
- **Sessions are tmux sessions.** Closing the browser or losing your connection does not stop them, and
  neither does restarting the standalone service. Restarting the Docker container does, but you can pick up
  conversations again with **Resume**.
- **Every API and terminal request** needs a logged-in session and must come from an allowed origin.

The diagrams are rendered by [mermaid.ink](https://mermaid.ink) from the Mermaid sources in [docs/diagrams](docs/diagrams);
the source layout is described in
[docs/development.md](docs/development.md).

## Quick start

On Linux (x86_64 / arm64) or macOS, no Docker needed:

```bash
curl -fsSL https://raw.githubusercontent.com/suriyadi15/hermithub/main/install.sh | bash
```

The installer detects your OS and CPU, installs tmux and git if they are missing (after asking), downloads the
`hermithub` executable to `~/.local/bin` and runs it as a user service (systemd on Linux, launchd on macOS). Then
it prints a link like `http://localhost:8787/setup?token=…`. Open it, choose a password, then go to **Settings**
to install an agent and connect GitHub.

Prefer Docker? It keeps agents isolated from the host, and on a server with a domain name it gets you HTTPS with
automatic certificates:

```bash
curl -fsSL https://raw.githubusercontent.com/suriyadi15/hermithub/main/install.sh | bash -s -- --docker
curl -fsSL https://raw.githubusercontent.com/suriyadi15/hermithub/main/install.sh | bash -s -- --docker --domain hub.example.com
```

All options, service management and uninstalling: [docs/installation.md](docs/installation.md).

Or let your AI agent do it: install the [HermitHub skill](docs/ai-install.md) (Claude Code:
`/plugin install hermithub --marketplace suriyadi15/hermithub`) and ask *"Install HermitHub on this
machine"*.

Docker by hand is just a compose file:

```bash
mkdir hermithub && cd hermithub
curl -fsSLO https://raw.githubusercontent.com/suriyadi15/hermithub/main/docker-compose.yml
echo "PUID=$(id -u)" > .env && echo "PGID=$(id -g)" >> .env
docker compose up -d
docker compose logs hermithub   # shows the setup link
```

## Updating

HermitHub checks for new releases and shows them in **Settings → Updates**. The standalone executable updates
itself from there with one click, or with `hermithub update` in a terminal. Automatic updates can be switched on
or off in Settings or with `hermithub auto-update on|off`. See [docs/installation.md](docs/installation.md#update).

Re-running the installer also updates whichever install it finds. For Docker, run this in the install folder:

```bash
docker compose pull && docker compose up -d
```

Updating the standalone executable keeps running sessions. Updating the Docker container stops them.
Conversations are kept either way; continue them with **Resume** on the project page. Installed agents live in the data folder and update themselves (or use
**Update** in Settings).

## Where things are stored

Standalone: settings in `~/.config/hermithub/env`, database in `~/.hermithub`, projects in `~/projects`.
Agents and logins are those of your user (`~/.local`, `~/.claude`, `~/.config/gh`…).

Docker: everything is in `./data` next to `docker-compose.yml`:

| Folder | Contents |
|---|---|
| `data/projects` | Your projects |
| `data/home` | Home folder of the container user: installed agents, their logins and history, GitHub CLI login, git config, SSH keys |
| `data/db` | Dashboard database (password, settings, session history) |

Back up `data/` to back up a Docker install. See [docs/configuration.md](docs/configuration.md) to put projects
somewhere else or share folders with the host.

## Documentation

- [Installation](docs/installation.md) — standalone executable or Docker, installer options, uninstall
- [Install with an AI agent](docs/ai-install.md) — skill for Claude Code, Codex and other agents
- [Configuration](docs/configuration.md) — `.env` options, data folders, resource limits
- [Agents](docs/agents.md) — installing, logging in, API keys, permission modes
- [Parallel tasks with worktrees](docs/worktrees.md) — one folder and branch per task, merge, clean up
- [GitHub & git](docs/github.md) — connecting GitHub, other git servers
- [Remote access](docs/reverse-proxy.md) — built-in HTTPS, Caddy / nginx, Cloudflare Tunnel, SSH tunnel
- [Security](docs/security.md) — what the dashboard can do and how it is protected
- [Development](docs/development.md) — running from source, architecture
- [Adding an agent](docs/adding-an-agent.md) — support another CLI in a few lines
- [Advanced](docs/advanced.md) — sharing host folders, migrating an existing setup

## Security

The dashboard gives **full shell access** to your user account (standalone) or the container (Docker), including
your agent and GitHub credentials.
By default it only listens on `127.0.0.1`. Expose it only over HTTPS, with a strong password, and ideally
behind an extra login layer such as Cloudflare Access or a VPN. Details in [docs/security.md](docs/security.md).

## Stack

| Part | Technology |
|---|---|
| Runtime | Bun, Node.js (for npm-based agents) |
| Backend | Elysia, SQLite (`bun:sqlite`), tmux, Bun's built-in PTY |
| API client | Eden Treaty (types straight from the backend) |
| Frontend | React 19, Vite, React Router, TanStack Query |
| UI | Tailwind CSS v4, shadcn/ui (Radix), lucide-react, sonner |
| Terminal / editor | xterm.js / Monaco |

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
