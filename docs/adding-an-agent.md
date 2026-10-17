# Adding an agent

Every agent is one entry in `AGENTS` in [`server/src/agents.ts`](../server/src/agents.ts). The dashboard,
session dialog and Settings page pick it up automatically.

```ts
{
  id: "myagent",                       // also the session mode id; lowercase
  name: "My Agent",
  vendor: "Example Inc.",
  homepage: "https://example.com/docs",
  bin: "myagent",                      // executable on PATH (~/.local/bin for npm globals)
  install: { kind: "npm", pkg: "@example/myagent" },
  // or: { kind: "script", install: "curl … | bash", update: "myagent update", uninstall: "rm -f ~/.local/bin/myagent" }
  authFiles: [".myagent/credentials.json"],   // relative to $HOME; any existing = logged in
  apiKey: { env: "MYAGENT_API_KEY", label: "My Agent API key", url: "https://example.com/keys" },
  login: { command: "myagent login --device", hint: "Open the link and enter the code." },
  logout: "myagent logout",
  permissionModes: [
    { id: "default", label: "Default — ask before acting", args: [] },
    { id: "auto", label: "Auto — no questions (risky)", args: ["--yes"] },
  ],
  launch: ({ resume, permissionArgs }) => ["myagent", ...(resume ? ["--continue"] : []), ...permissionArgs],
}
```

Guidelines:

- **Login must work without a local browser.** Prefer device-code flows or "paste the code" flows. The
  task terminal shows the last URL and `XXXX-XXXX` style code it prints as buttons.
- **Keep state in `$HOME`** so it persists in the home volume.
- Optional `loggedIn()` replaces the `authFiles` check when credentials share a file with other state
  (Copilot, Crush).
- Optional `env` adds variables to every session of the agent; optional `onApiKey(key)` runs when the key
  changes (e.g. to tell the CLI to use it).
- Add a `buildCommand` case to `server/test/parsers.test.ts` and an icon/color in `web/src/lib/modes.ts`
  (`AGENT_STYLE`; a default is used otherwise).
- Document it in `docs/agents.md`.
