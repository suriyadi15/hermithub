# Security policy

HermitHub provides shell access by design, so the login, origin checks, setup token and path checks are
the security boundary. Issues that bypass them are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue.** Use GitHub's private vulnerability reporting
("Security" → "Report a vulnerability") on this repository. Include steps to reproduce and the affected
version. You should get a reply within a few days.

## Supported versions

Only the latest release receives fixes.

## Scope

In scope: authentication bypass, cross-site request / WebSocket attacks, path traversal out of the projects
folder, the setup flow, leaking credentials to unauthenticated users.

Out of scope: anything an authenticated user can do (they have a shell by design), agents acting within
the permission mode you chose, and deployments that expose the port without HTTPS.
