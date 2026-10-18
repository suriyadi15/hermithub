# Contributing

Thanks for helping! Bug reports, docs fixes, new agents and features are all welcome.

## Getting started

See [docs/development.md](docs/development.md) to run the app from source. Before opening a pull request:

```bash
bun run typecheck
bun test server
bun run build
```

## Guidelines

- Keep pull requests focused; describe what changed and how you tested it.
- Match the surrounding code style (TypeScript strict, Prettier-like formatting, small comments that explain *why*).
- New agent? It is usually one entry in `server/src/agents.ts` — see [docs/adding-an-agent.md](docs/adding-an-agent.md).
- UI changes should work on phones too (the project page has a dedicated mobile layout).
- Anything touching auth, file paths or shell commands: explain the security impact in the PR.

## Reporting bugs

Open an issue with steps to reproduce, the version (Settings → About) and relevant
`docker compose logs hermithub` output. Security issues: see [SECURITY.md](SECURITY.md).
