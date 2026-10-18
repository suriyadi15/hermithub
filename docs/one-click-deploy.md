# One-click deploy

The Docker image needs a single volume, mounted at `/home/hermithub` (the home of the container user: database,
projects, installed agents and their logins). That is what hosting platforms offer, so HermitHub runs on them
without a server of your own.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/suriyadi15/hermithub)

| Platform | How |
|---|---|
| Render | The button above (Blueprint in [`render.yaml`](../render.yaml)). Needs a paid plan for the disk. |
| Railway | Template made in the Railway dashboard; values in [`deploy/railway.md`](../deploy/railway.md). |
| Coolify | Service template in [`deploy/coolify/hermithub.yaml`](../deploy/coolify/hermithub.yaml). Until it is in Coolify's catalog, paste it as a Docker Compose resource. |
| Anything else that runs a container | See below. |

## Any container platform

| Setting | Value |
|---|---|
| Image | `ghcr.io/suriyadi15/hermithub:latest` (amd64 and arm64) |
| Volume | One, mounted at `/home/hermithub` |
| Port | `8787` (or whatever the platform puts in `PORT`) |
| Health check | `GET /api/health` |
| `HERMITHUB_PASSWORD` | A generated secret: the login password |
| `TRUST_PROXY` | `1` behind the platform's proxy |

Without `HERMITHUB_PASSWORD`, the first visitor creates the password on the setup page, which needs the setup
link from the logs. The link uses `PUBLIC_ORIGIN`, or the domain Railway or Render assigned.

Other variables are in [Configuration](configuration.md). To keep projects on a second volume, mount it anywhere
and point `PROJECTS_DIR` at it.

## Good to know

- **Memory**: give it at least 2 GB. Claude Code, Codex and the other agents are heavy, and several sessions
  add up.
- **Password**: `HERMITHUB_PASSWORD` is only used on the first start. Change it later in
  **Settings → Change password**; editing the variable has no effect.
- **Restarts**: a redeploy or restart stops running agent sessions. Conversations are kept on the volume:
  continue them from the project page with **Resume**.
- **Updates**: redeploy to pull the latest image. Agents installed from the dashboard live on the volume and
  update themselves.
- **Security**: the dashboard is a shell on the container and is public from the start. Use a strong password
  and turn on two-factor authentication in Settings. See [Security](security.md).
