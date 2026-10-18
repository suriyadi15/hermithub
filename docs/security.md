# Security

HermitHub is a remote shell with a web UI. Anyone who logs in can run any command in the container (Docker)
or as your user account (standalone executable), and read everything there — your projects, agent credentials,
GitHub token and SSH key. Treat the password like an SSH key.

## What protects it

- **Localhost by default.** The port is bound to `127.0.0.1`; reaching it from elsewhere needs a proxy,
  tunnel or an explicit `HUB_BIND`.
- **Setup token.** Until a password exists, setting one requires a random token printed in the server logs,
  so whoever reaches the port first cannot claim the instance.
- **Password login** (argon2 hash), `HttpOnly`, `SameSite=Strict` cookies, `Secure` over HTTPS. After 5 failed
  attempts an IP is locked out for 15 minutes, and after 30 failures from any IPs all logins pause for 15
  minutes. Client IPs come from proxy headers only when `TRUST_PROXY` is set. Session tokens are stored
  hashed. Changing the password signs out every device.
- **Two-factor authentication (optional).** Turn it on in **Settings → Two-factor authentication** to also ask
  for a code from an authenticator app (TOTP). Each code works once, wrong codes count toward the lockout,
  and ten single-use recovery codes are shown once when you turn it on. Turning it on signs out other devices.
- **Security headers**: no framing (`frame-ancestors 'none'`), `nosniff`, `no-referrer`; downloads are
  always served as attachments.
- **Same-origin checks** on every non-GET request and every WebSocket.
- **Path checks.** File APIs resolve every path (symlinks included) and refuse anything outside the projects folder.
- **Container isolation (Docker).** Agents run as an unprivileged user in the container. Nothing from the host is
  mounted except the data folders, and agent and GitHub logins are separate from the host's.
- **Standalone executable: no isolation.** Agents run as your user and can reach everything that user can:
  other folders, `~/.ssh`, cloud CLIs and their credentials. The installer refuses to run as root. For a shared or
  internet-facing server, prefer Docker or a dedicated user account (e.g. `adduser hub`) for the hub.

- **Updates** come only from the GitHub releases of the repository (`HUB_REPO`) over HTTPS. The executable is
  installed only when it matches the release's `SHA256SUMS` and starts. Installing an update needs a logged-in
  session, like everything else. Automatic updates are off unless you turn them on.

## Recommendations

- Serve it over HTTPS only, and add a second factor in front: Cloudflare Access, a VPN (Tailscale, WireGuard)
  or your proxy's auth.
- Use a long, unique password and turn on two-factor authentication.
- Prefer permission modes that ask before running commands. "Bypass" / "YOLO" modes let an agent do anything
  the container user can do, including pushing with your GitHub login.
- Give GitHub tokens only the scopes you need; fine-grained tokens limited to some repositories work too.
- API keys and the two-factor secret are stored in plain text in `data/db/hub.db` and visible to processes in the container. Keep the
  data folder private (`chmod 700`) and out of shared backups.
- Set `mem_limit` so a runaway process cannot take down the host.

## Lost your authenticator?

Log in with a recovery code. If you have none left, turn two-factor authentication off from the server:

```bash
docker compose exec -u hub hermithub bun run disable-2fa
```

## Reporting vulnerabilities

See [SECURITY.md](../SECURITY.md).
