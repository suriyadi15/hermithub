# Install with an AI agent

HermitHub ships an [Agent Skill](../skills/hermithub/SKILL.md) that teaches coding agents how to
install, update and troubleshoot it. Give it to the agent running on (or with SSH access to) the machine
that should host the hub, then just ask.

## Claude Code

```text
/plugin install hermithub --marketplace suriyadi15/hermithub
```

On older versions:

```text
/plugin marketplace add suriyadi15/hermithub
/plugin install hermithub@hermithub
```

## Codex CLI and other agents with skill support

Copy the skill folder into the agent's skills directory:

```bash
git clone --depth 1 https://github.com/suriyadi15/hermithub /tmp/hermithub-skill
cp -r /tmp/hermithub-skill/skills/hermithub ~/.codex/skills/     # Codex CLI
cp -r /tmp/hermithub-skill/skills/hermithub ~/.claude/skills/    # Claude Code, without the plugin system
rm -rf /tmp/hermithub-skill
```

## Any other agent

No install needed — point it at the instructions:

```text
Read https://raw.githubusercontent.com/suriyadi15/hermithub/main/skills/hermithub/SKILL.md
and follow it to install HermitHub on this machine.
```

## What to ask

- "Install HermitHub on this machine."
- "Install HermitHub on my VPS `root@203.0.113.10` with the domain `hub.example.com`."
- "Update HermitHub."
- "HermitHub doesn't load over HTTPS, fix it."
- "I lost the HermitHub setup link."
- "Uninstall HermitHub but keep my projects."

The agent picks the standalone executable or Docker with you, checks what is missing, asks before installing anything with `sudo` or exposing ports, runs the installer
and gives you the setup link. It does not choose your password or log in to agents/GitHub for you — you do
that in the dashboard.
