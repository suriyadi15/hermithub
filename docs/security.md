# Security

Project Hub is a remote shell with a web UI. Anyone who logs in can run any command in the container and
read everything in it — your projects, agent credentials, GitHub token and SSH key. Treat the password
like an SSH key.

## What protects it

- **Localhost by default.** The port is bound to `127.0.0.1`; reaching it from elsewhere needs a proxy,
  tunnel or an explicit `HUB_BIND`.
- **Setup token.** Until a password exists, setting one requires a random token printed in the server logs,
  so whoever reaches the port first cannot claim the instance.
- **Password login** (argon2 hash), `HttpOnly`, `SameSite=Strict` cookies, `Secure` over HTTPS. After 5 failed
  attempts an IP is locked out for 15 minutes. Changing the password signs out every device.
- **Same-origin checks** on every non-GET request and every WebSocket.
- **Path checks.** File APIs resolve every path (symlinks included) and refuse anything outside the projects folder.
- **Container isolation.** Agents run as an unprivileged user in the container. Nothing from the host is
  mounted except the data folders.
- **No host credentials.** Agent and GitHub logins are separate from the host's.

## Recommendations

- Serve it over HTTPS only, and add a second factor in front: Cloudflare Access, a VPN (Tailscale, WireGuard)
  or your proxy's auth.
- Use a long, unique password.
- Prefer permission modes that ask before running commands. "Bypass" / "YOLO" modes let an agent do anything
  the container user can do, including pushing with your GitHub login.
- Give GitHub tokens only the scopes you need; fine-grained tokens limited to some repositories work too.
- API keys are stored in plain text in `data/db/hub.db` and visible to processes in the container. Keep the
  data folder private (`chmod 700`) and out of shared backups.
- Set `mem_limit` so a runaway process cannot take down the host.

## Reporting vulnerabilities

See [SECURITY.md](../SECURITY.md).
