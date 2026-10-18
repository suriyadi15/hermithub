# Railway template

Railway templates are made in the dashboard, not from a file in the repository. These are the values to
enter at **railway.com → Templates → New Template**:

| Field | Value |
|---|---|
| Service source | Docker image `ghcr.io/suriyadi15/hermithub:latest` |
| Volume | Mount path `/home/hermithub` |
| Public networking | HTTP, port `8787` |
| Healthcheck path | `/api/health` |

Variables:

| Name | Value | Why |
|---|---|---|
| `HERMITHUB_PASSWORD` | `${{secret(24)}}` | Login password, generated per deploy. Only used on the first start. |
| `TRUST_PROXY` | `1` | Railway's proxy sets `X-Forwarded-For`; used for the failed-login lockout. |
| `PORT` | `8787` | Keeps the app on the port public networking points to. |

Template description (suggested): *Self-hosted dashboard for your projects and AI coding agents — Claude Code,
Codex CLI, Gemini CLI and more. Start agent sessions from any browser, close the tab, they keep running.*

Notes for the template page:

- Pick at least 2 GB of memory; agents are heavy.
- The password is under the service's **Variables**. Change it later in **Settings → Change password**; editing the
  variable after the first start has no effect.
- A redeploy or restart stops running agent sessions. Conversations are kept: continue them with **Resume**.

Once published, add the button to the README:

```markdown
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/<template-code>)
```
