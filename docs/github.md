# GitHub & git

## Connect GitHub

**Settings → GitHub → Log in with GitHub.** A terminal runs `gh auth login`:

1. Answer *Authenticate Git with your GitHub credentials?* with Enter (yes).
2. Copy the one-time code (also shown as a button), press Enter, open the sign-in page and enter the code.

Afterwards `gh auth setup-git` is run, so `git clone`, `pull` and `push` over HTTPS use your login in every
session — including **New project → Clone from URL** for private repositories. SSH-style GitHub URLs
(`git@github.com:user/repo.git`) are rewritten to HTTPS automatically.

**Use a token** instead: create a [personal access token](https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=Project%20Hub)
with the `repo`, `read:org` and `workflow` scopes and paste it.

The login is stored in `data/home/.config/gh`. Agents can use `gh` too (e.g. to open pull requests).

## Git identity

**Settings → Git identity** sets `user.name` and `user.email` (`git config --global`) for commits made from
the dashboard, the terminal and by agents.

## Other git servers (GitLab, Bitbucket, self-hosted)

**Settings → SSH key → Generate SSH key** creates `~/.ssh/id_ed25519`. Copy the public key into your git
server's SSH keys, then clone with the SSH URL. Host keys are accepted on first use.

HTTPS with a token also works: run `git config --global credential.helper store` in a terminal once and
enter the token as the password on the first clone.
