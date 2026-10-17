# Install with an AI agent

Project Hub ships an [Agent Skill](../skills/project-hub/SKILL.md) that teaches coding agents how to
install, update and troubleshoot it. Give it to the agent running on (or with SSH access to) the machine
that should host the hub, then just ask.

## Claude Code

```text
/plugin install project-hub --marketplace suriyadi15/project-hub
```

On older versions:

```text
/plugin marketplace add suriyadi15/project-hub
/plugin install project-hub@project-hub
```

## Codex CLI and other agents with skill support

Copy the skill folder into the agent's skills directory:

```bash
git clone --depth 1 https://github.com/suriyadi15/project-hub /tmp/project-hub-skill
cp -r /tmp/project-hub-skill/skills/project-hub ~/.codex/skills/     # Codex CLI
cp -r /tmp/project-hub-skill/skills/project-hub ~/.claude/skills/    # Claude Code, without the plugin system
rm -rf /tmp/project-hub-skill
```

## Any other agent

No install needed — point it at the instructions:

```text
Read https://raw.githubusercontent.com/suriyadi15/project-hub/main/skills/project-hub/SKILL.md
and follow it to install Project Hub on this machine.
```

## What to ask

- "Install Project Hub on this machine."
- "Install Project Hub on my VPS `root@203.0.113.10` with the domain `hub.example.com`."
- "Update Project Hub."
- "Project Hub doesn't load over HTTPS, fix it."
- "I lost the Project Hub setup link."
- "Uninstall Project Hub but keep my projects."

The agent picks the standalone executable or Docker with you, checks what is missing, asks before installing anything with `sudo` or exposing ports, runs the installer
and gives you the setup link. It does not choose your password or log in to agents/GitHub for you — you do
that in the dashboard.
