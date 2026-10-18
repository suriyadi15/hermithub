# Deploy kit

Everything needed to list HermitHub on hosting platforms and app catalogs.

| File | For |
|---|---|
| [`../render.yaml`](../render.yaml) | Render Blueprint (the Deploy to Render button) |
| [`railway.md`](railway.md) | Values for the Railway template, made in the Railway dashboard |
| [`coolify/hermithub.yaml`](coolify/hermithub.yaml) | Coolify service template (PR to `coollabsio/coolify`, with the logo as `svgs/hermithub.svg`) |
| [`assets/hermithub.svg`](assets/hermithub.svg) | Logo, vector |
| [`assets/hermithub-512.png`](assets/hermithub-512.png) | Logo, 512×512 PNG |
| [`../site/src/assets/screenshots/`](../site/src/assets/screenshots/) | Screenshots (demo data): dashboard, session, editor, Git panel, phone |

How the image runs on a platform: [docs/one-click-deploy.md](../docs/one-click-deploy.md).

## Listing text

**Name:** HermitHub

**Tagline:** Self-hosted dashboard for your projects and AI coding agents.

**Short description:** Run Claude Code, Codex CLI, Gemini CLI, OpenCode and other AI coding agents from any
browser, phone included. Start sessions in your projects, close the tab, and they keep running on the server.

**Long description:**

> HermitHub is a web dashboard for your code projects and AI coding agents — Claude Code, Codex CLI, Gemini CLI,
> OpenCode, GitHub Copilot CLI, Qwen Code and Crush. Open it from any browser, start agent sessions in your
> projects and close the tab: sessions keep running on the server, in a web terminal backed by tmux.
>
> Agents, their logins, GitHub access and git settings are all set up from the dashboard. It also has a file
> tree with a code editor, a Git panel, parallel tasks on git worktrees, CPU and memory per session, and a
> mobile-friendly layout. Open source (MIT).

**Category / tags:** Developer tools · ai, agents, claude, codex, gemini, terminal, ide, git

**Links:** website <https://hermithub.pages.dev> · source <https://github.com/suriyadi15/hermithub> · license MIT

## Technical facts

| | |
|---|---|
| Image | `ghcr.io/suriyadi15/hermithub:latest` (linux/amd64, linux/arm64) |
| Port | `8787` (follows `PORT` if the platform sets it) |
| Volume | One, at `/home/hermithub` |
| Health check | `GET /api/health` |
| Memory | 2 GB recommended, 1 GB minimum |
| Login | `HERMITHUB_PASSWORD` seeds the password on first start; otherwise a setup link is printed in the logs |
| Behind a proxy | `TRUST_PROXY=1` |
| Updates | Pull the new image; agents installed from the dashboard live on the volume and update themselves |
