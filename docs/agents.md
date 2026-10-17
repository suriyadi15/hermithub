# Agents

Project Hub runs AI coding agents as interactive terminal programs in your projects. Supported out of the box:

| Agent | Installed with | Login | API key |
|---|---|---|---|
| Claude Code (Anthropic) | official native installer | `claude auth login` (Claude subscription or Console) | `ANTHROPIC_API_KEY` |
| Codex CLI (OpenAI) | `npm i -g @openai/codex` | `codex login --device-auth` (ChatGPT account) | `OPENAI_API_KEY` |
| Gemini CLI (Google) | `npm i -g @google/gemini-cli` | Google login inside `gemini` | `GEMINI_API_KEY` |
| OpenCode (Anomaly) | `npm i -g opencode-ai` | `opencode auth login` (Anthropic, OpenAI, Copilot, OpenRouter, … or a provider key) | — |
| GitHub Copilot CLI (GitHub) | `npm i -g @github/copilot` | `copilot login --device-code` (Copilot subscription) | `COPILOT_GITHUB_TOKEN` |
| Qwen Code (Alibaba Qwen) | `npm i -g @qwen-code/qwen-code` | `/auth` inside `qwen` (Qwen OAuth or an API provider) | — |
| Crush (Charm) | `npm i -g @charmland/crush` | `crush login hyper\|copilot\|openai\|grok`, or a provider key on first launch | — |

Want another one? See [adding-an-agent.md](adding-an-agent.md).

## Install

**Settings → AI agents → Install.** The install runs in a web terminal so you can follow it. Agents go to
`~/.local` in the persistent home folder, so they survive image updates. **Update** gets the latest version;
Claude Code also updates itself.

## Log in

Click **Log in**. A terminal opens with the agent's sign-in flow. Sign-in links and one-time codes are also
shown as buttons above the terminal:

- **Claude Code**: open the link, sign in, copy the code shown by Anthropic and paste it into the terminal.
- **Codex CLI**: open the link and enter the one-time code (device login). Device login must be allowed
  in your ChatGPT security settings.
- **Gemini CLI**: choose *Login with Google*, open the link, paste the authorization code back, then `/quit`.
- **OpenCode**: pick a provider; subscription providers print a link to open, others ask for their API key.
- **GitHub Copilot CLI**: open the link and enter the one-time code. There is no keyring in the container,
  so answer *yes* when it asks to store the token in plain text (`~/.copilot/config.json`).
- **Qwen Code**: type `/auth`, choose Qwen OAuth (open the link) or an API provider, then `/quit`.
- **Crush**: type the platform (`hyper`, `copilot`, `openai` or `grok`) and follow the link. Other providers
  (Anthropic, OpenRouter, …) ask for an API key the first time you start Crush.

You can also skip this and sign in the first time you start a session.

### API keys instead

Paste a key into the agent's **API key** field. It is stored in the dashboard database and passed to that
agent's sessions as an environment variable (Copilot takes a fine-grained GitHub token with the *Copilot
Requests* permission). For Codex it is stored with `codex login --with-api-key`; for
Gemini the CLI is switched to API-key auth.

## Sessions

From a project, start a session and choose:

- **Agent** — any installed agent, or **Claude Remote Control** (control the session from claude.ai/code or
  the Claude app; Claude subscription required), or a plain **Terminal**.
- **Permission mode** — how much the agent may do without asking. The default per agent is set in Settings.

| Agent | Modes |
|---|---|
| Claude Code | `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions` |
| Codex CLI | default, `read-only`, `workspace-write` sandbox, `yolo` (`--dangerously-bypass-approvals-and-sandbox`) |
| Gemini CLI | `default`, `auto_edit`, `plan`, `yolo` |
| OpenCode | default (build agent), `plan` (`--agent plan`), `auto` (`--auto`) |
| GitHub Copilot CLI | default, `plan`, `autopilot`, `yolo` |
| Qwen Code | `default`, `auto-edit`, `plan`, `auto`, `yolo` |
| Crush | default, `yolo` |

- **Continue the last conversation** — Claude `--continue`, Codex `resume --last`, Gemini `--resume latest`;
  OpenCode, Copilot, Qwen Code and Crush `--continue`.

Sessions live in tmux inside the container: closing the browser does not stop them, and several devices
can watch the same session. Restarting a session continues its conversation. Recreating the container
(updates, `docker compose up -d` after config changes) stops all sessions; use **Resume** on the project page.

> **Codex sandbox in Docker**: Codex's own sandbox relies on Linux kernel features that are often not
> available inside containers. If commands fail with sandbox errors, use the `yolo` mode — the container
> itself is the sandbox then.

## First run in a new folder

Agents ask whether you trust a folder the first time they open it. Answer in the terminal.
