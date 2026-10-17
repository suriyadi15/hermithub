import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Elysia, t } from "elysia";
import { getSetting, logActivity, setSetting } from "./db";
import { exec, HttpError } from "./exec";
import { HOME } from "./paths";
import { runTask } from "./tasks";

export interface PermissionMode {
  id: string;
  label: string;
  args: string[];
}

/**
 * One AI coding agent CLI. Adding an agent to Project Hub means adding one entry to AGENTS:
 * how to install it, how to tell whether it is logged in, and how to launch it in a project.
 */
export interface AgentDef {
  id: string;
  name: string;
  vendor: string;
  homepage: string;
  /** Executable looked up on PATH (npm globals and native installers land in ~/.local/bin). */
  bin: string;
  install:
    | { kind: "npm"; pkg: string }
    | { kind: "script"; install: string; update: string; uninstall: string };
  /** Files (relative to $HOME) whose presence means the agent is logged in. */
  authFiles: string[];
  /** Overrides the authFiles check, for agents whose credentials share a file with other settings. */
  loggedIn?(): boolean;
  /** Optional API key alternative to an interactive login. Injected into the agent's sessions as `env`. */
  apiKey?: { env: string; label: string; url: string };
  /** Interactive login, run in a web terminal. */
  login: { command: string; hint: string; env?: Record<string, string> };
  logout: string;
  permissionModes: PermissionMode[];
  launch(opts: { resume?: boolean; permissionArgs: string[] }): string[];
  /** Extra environment for every session of this agent. */
  env?: Record<string, string>;
  /** Called after the API key changes, e.g. to tell the CLI to use it. */
  onApiKey?(key: string | null): Promise<void>;
}

const claudeModes: [string, string][] = [
  ["default", "Default — ask before each risky action"],
  ["acceptEdits", "Accept edits — edit files freely, still ask for commands"],
  ["plan", "Plan — read and plan only, no changes"],
  ["auto", "Auto — Claude decides what is safe"],
  ["dontAsk", "Don't ask — deny anything not pre-approved"],
  ["bypassPermissions", "Bypass — run everything without asking (risky)"],
];

const geminiModes: [string, string][] = [
  ["default", "Default — ask before each tool call"],
  ["auto_edit", "Auto edit — edit files freely, still ask for commands"],
  ["plan", "Plan — read and plan only, no changes"],
  ["yolo", "YOLO — run everything without asking (risky)"],
];

const qwenModes: [string, string][] = [
  ["default", "Default — ask before file edits and commands"],
  ["auto-edit", "Auto edit — edit files freely, still ask for commands"],
  ["plan", "Plan — read and plan only, no changes"],
  ["auto", "Auto — a classifier approves safe actions"],
  ["yolo", "YOLO — run everything without asking (risky)"],
];

/** Parsed JSON file under $HOME, or null when missing or invalid. */
function readHomeJson(path: string): any {
  try {
    return JSON.parse(readFileSync(join(HOME, path), "utf8"));
  } catch {
    return null;
  }
}

async function mergeJson(path: string, patch: (cur: any) => any) {
  let cur: any = {};
  try {
    cur = JSON.parse(await readFile(path, "utf8"));
  } catch {}
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(patch(cur), null, 2) + "\n");
}

export const AGENTS: AgentDef[] = [
  {
    id: "claude",
    name: "Claude Code",
    vendor: "Anthropic",
    homepage: "https://docs.claude.com/en/docs/claude-code/overview",
    bin: "claude",
    install: {
      kind: "script",
      install: "curl -fsSL https://claude.ai/install.sh | bash",
      update: "claude update",
      uninstall: "rm -rf ~/.local/bin/claude ~/.local/share/claude",
    },
    authFiles: [".claude/.credentials.json"],
    apiKey: { env: "ANTHROPIC_API_KEY", label: "Anthropic API key", url: "https://console.anthropic.com/settings/keys" },
    login: {
      command: "claude auth login",
      hint: "Open the link, sign in, then paste the code back into the terminal.",
    },
    logout: "claude auth logout",
    permissionModes: claudeModes.map(([id, label]) => ({ id, label, args: ["--permission-mode", id] })),
    launch: ({ resume, permissionArgs }) => ["claude", ...(resume ? ["--continue"] : []), ...permissionArgs],
  },
  {
    id: "codex",
    name: "Codex CLI",
    vendor: "OpenAI",
    homepage: "https://developers.openai.com/codex/cli",
    bin: "codex",
    install: { kind: "npm", pkg: "@openai/codex" },
    authFiles: [".codex/auth.json"],
    apiKey: { env: "OPENAI_API_KEY", label: "OpenAI API key", url: "https://platform.openai.com/api-keys" },
    login: {
      command: "codex login --device-auth",
      hint: "Open the link and enter the one-time code shown in the terminal.",
    },
    logout: "codex logout",
    permissionModes: [
      { id: "default", label: "Default — Codex's own approval settings", args: [] },
      { id: "read-only", label: "Read only — can read files, asks for everything else", args: ["--sandbox", "read-only"] },
      { id: "workspace-write", label: "Workspace write — may edit files in the project", args: ["--sandbox", "workspace-write"] },
      {
        id: "yolo",
        label: "YOLO — no approvals, no sandbox (risky)",
        args: ["--dangerously-bypass-approvals-and-sandbox"],
      },
    ],
    launch: ({ resume, permissionArgs }) => (resume ? ["codex", "resume", "--last", ...permissionArgs] : ["codex", ...permissionArgs]),
    // Codex keeps API keys in ~/.codex/auth.json rather than reading them from the environment.
    async onApiKey(key) {
      if (key && Bun.which("codex")) await exec(["codex", "login", "--with-api-key"], { stdin: key, timeoutMs: 30_000 });
    },
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    vendor: "Google",
    homepage: "https://github.com/google-gemini/gemini-cli",
    bin: "gemini",
    install: { kind: "npm", pkg: "@google/gemini-cli" },
    authFiles: [".gemini/oauth_creds.json"],
    apiKey: { env: "GEMINI_API_KEY", label: "Gemini API key", url: "https://aistudio.google.com/apikey" },
    login: {
      command: "gemini",
      hint: 'Choose "Login with Google", open the link, paste the code back, then type /quit.',
      // No browser in the container: Gemini prints the URL and asks for the code instead.
      env: { NO_BROWSER: "true" },
    },
    logout: "rm -f ~/.gemini/oauth_creds.json",
    permissionModes: geminiModes.map(([id, label]) => ({ id, label, args: ["--approval-mode", id] })),
    launch: ({ resume, permissionArgs }) => ["gemini", ...(resume ? ["--resume", "latest"] : []), ...permissionArgs],
    env: { NO_BROWSER: "true" },
    // Without a selected auth type Gemini opens its login dialog even when GEMINI_API_KEY is set.
    async onApiKey(key) {
      await mergeJson(join(HOME, ".gemini", "settings.json"), (cur) => {
        const auth = { ...cur.security?.auth };
        if (key) auth.selectedType = "gemini-api-key";
        else if (auth.selectedType === "gemini-api-key") delete auth.selectedType;
        return { ...cur, security: { ...cur.security, auth } };
      });
    },
  },
  {
    id: "opencode",
    name: "OpenCode",
    vendor: "Anomaly",
    homepage: "https://opencode.ai/docs",
    bin: "opencode",
    install: { kind: "npm", pkg: "opencode-ai" },
    authFiles: [".local/share/opencode/auth.json"],
    login: {
      command: "opencode auth login",
      hint: "Pick a provider (Anthropic, OpenAI, GitHub Copilot, OpenRouter, …), then open the link or paste its API key.",
    },
    logout: "opencode auth logout",
    permissionModes: [
      { id: "default", label: "Default — build agent, asks as its permission config says", args: [] },
      { id: "plan", label: "Plan — plan agent, read and plan only", args: ["--agent", "plan"] },
      { id: "auto", label: "Auto — approve everything not explicitly denied (risky)", args: ["--auto"] },
    ],
    launch: ({ resume, permissionArgs }) => ["opencode", ...(resume ? ["--continue"] : []), ...permissionArgs],
  },
  {
    id: "copilot",
    name: "GitHub Copilot CLI",
    vendor: "GitHub",
    homepage: "https://docs.github.com/copilot/how-tos/copilot-cli",
    bin: "copilot",
    install: { kind: "npm", pkg: "@github/copilot" },
    authFiles: [".copilot/config.json"],
    // config.json is created on first run too; without a keyring the token is stored in it.
    loggedIn: () => {
      const users = readHomeJson(".copilot/config.json")?.loggedInUsers;
      return Array.isArray(users) && users.length > 0;
    },
    apiKey: {
      env: "COPILOT_GITHUB_TOKEN",
      label: "GitHub token (fine-grained, Copilot Requests)",
      url: "https://github.com/settings/personal-access-tokens/new",
    },
    login: {
      command: "copilot login --device-code",
      hint: "Open the link and enter the one-time code. Allow storing the token in plain text when asked (no keyring in the container).",
    },
    logout: 'echo "Type /logout, then /exit."; copilot',
    permissionModes: [
      { id: "default", label: "Default — ask before each tool, path and URL", args: [] },
      { id: "plan", label: "Plan — plan first, no changes until approved", args: ["--plan"] },
      { id: "autopilot", label: "Autopilot — keep going until done, still asks for tools", args: ["--autopilot"] },
      { id: "yolo", label: "YOLO — allow all tools, paths and URLs (risky)", args: ["--yolo"] },
    ],
    launch: ({ resume, permissionArgs }) => ["copilot", ...(resume ? ["--continue"] : []), ...permissionArgs],
  },
  {
    id: "qwen",
    name: "Qwen Code",
    vendor: "Alibaba Qwen",
    homepage: "https://github.com/QwenLM/qwen-code",
    bin: "qwen",
    install: { kind: "npm", pkg: "@qwen-code/qwen-code" },
    authFiles: [".qwen/oauth_creds.json"],
    // API-key providers chosen with /auth are saved in settings.json instead.
    loggedIn: () =>
      existsSync(join(HOME, ".qwen/oauth_creds.json")) || !!readHomeJson(".qwen/settings.json")?.security?.auth?.selectedType,
    login: {
      command: "qwen",
      hint: "Type /auth, choose Qwen OAuth (open the link) or an API provider, then type /quit.",
      env: { NO_BROWSER: "true" },
    },
    logout: "rm -f ~/.qwen/oauth_creds.json",
    permissionModes: qwenModes.map(([id, label]) => ({ id, label, args: ["--approval-mode", id] })),
    launch: ({ resume, permissionArgs }) => ["qwen", ...(resume ? ["--continue"] : []), ...permissionArgs],
    env: { NO_BROWSER: "true" },
  },
  {
    id: "crush",
    name: "Crush",
    vendor: "Charm",
    homepage: "https://github.com/charmbracelet/crush",
    bin: "crush",
    install: { kind: "npm", pkg: "@charmland/crush" },
    authFiles: [".local/share/crush/crush.json"],
    // Logins and API keys entered in Crush are saved per provider in its data config, next to other state.
    loggedIn: () => {
      const providers = readHomeJson(".local/share/crush/crush.json")?.providers ?? {};
      return Object.values<any>(providers).some((p) => p?.api_key || p?.oauth);
    },
    login: {
      command: 'read -rp "Platform (hyper, copilot, openai, grok) [hyper]: " p; crush login "${p:-hyper}"',
      hint: "Choose a platform, then open the link and enter the code. Other providers take an API key on first launch.",
    },
    logout: 'read -rp "Platform (hyper, copilot, openai, grok) [hyper]: " p; crush logout "${p:-hyper}"',
    permissionModes: [
      { id: "default", label: "Default — ask before each tool call", args: [] },
      { id: "yolo", label: "YOLO — accept all permissions (risky)", args: ["--yolo"] },
    ],
    launch: ({ resume, permissionArgs }) => ["crush", ...(resume ? ["--continue"] : []), ...permissionArgs],
  },
];

export const AGENT_IDS = AGENTS.map((a) => a.id);

export function getAgent(id: string): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id);
}

export function installScript(a: AgentDef, action: "install" | "update" | "uninstall") {
  if (a.install.kind === "script") return a.install[action];
  return action === "uninstall" ? `npm uninstall -g ${a.install.pkg}` : `npm install -g ${a.install.pkg}@latest`;
}

export function binPath(a: AgentDef) {
  return Bun.which(a.bin, { PATH: process.env.PATH ?? "" });
}

/** `--version` output, cached per binary until it changes (installs and updates replace it). */
const versionCache = new Map<string, { mtime: number; version: string | null }>();

export async function agentVersion(a: AgentDef): Promise<string | null> {
  const path = binPath(a);
  if (!path) return null;
  let mtime = 0;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {}
  const hit = versionCache.get(path);
  if (hit && hit.mtime === mtime) return hit.version;
  const r = await exec([path, "--version"], { timeoutMs: 10_000 });
  const version = r.code === 0 ? (r.stdout.trim().match(/\d+\.\d+[\w.\-+]*/)?.[0]?.replace(/\.$/, "") ?? (r.stdout.trim() || null)) : null;
  versionCache.set(path, { mtime, version });
  return version;
}

export function hasLogin(a: AgentDef) {
  if (a.loggedIn) return a.loggedIn();
  return a.authFiles.some((f) => existsSync(join(HOME, f)));
}

/** Arguments for a permission mode id; unknown or missing ids add nothing. */
export function permissionArgs(a: AgentDef, permission?: string) {
  if (!permission) return [];
  return a.permissionModes.find((m) => m.id === permission)?.args ?? [];
}


const keySetting = (a: AgentDef) => `agent.${a.id}.api_key`;
const permSetting = (a: AgentDef) => `agent.${a.id}.permission`;

export function requireAgent(id: string): AgentDef {
  const a = getAgent(id);
  if (!a) throw new HttpError(404, `Unknown agent "${id}"`);
  return a;
}

export function defaultPermission(a: AgentDef): string {
  const saved = getSetting(permSetting(a)) ?? (a.id === "claude" ? getSetting("default_permission") : null);
  return saved && a.permissionModes.some((m) => m.id === saved) ? saved : a.permissionModes[0]!.id;
}

/** Environment for the agent's sessions: its own extras plus the API key, if one is saved. */
export function agentEnv(a: AgentDef): Record<string, string> {
  const key = getSetting(keySetting(a));
  return { ...a.env, ...(a.apiKey && key ? { [a.apiKey.env]: key } : {}) };
}

export async function agentStatus(a: AgentDef) {
  const key = getSetting(keySetting(a));
  const version = await agentVersion(a);
  return {
    id: a.id,
    name: a.name,
    vendor: a.vendor,
    homepage: a.homepage,
    installed: !!binPath(a),
    version,
    loggedIn: hasLogin(a),
    apiKey: a.apiKey ? { env: a.apiKey.env, label: a.apiKey.label, url: a.apiKey.url, hint: key ? `…${key.slice(-4)}` : null } : null,
    loginHint: a.login.hint,
    permissionModes: a.permissionModes.map(({ id, label }) => ({ id, label })),
    defaultPermission: defaultPermission(a),
    remoteControl: a.id === "claude",
  };
}

export type AgentInfo = Awaited<ReturnType<typeof agentStatus>>;

const TASK_ACTIONS = ["install", "update", "uninstall", "login", "logout"] as const;
const ACTION_LABEL = { install: "Install", update: "Update", uninstall: "Uninstall", login: "Log in to", logout: "Log out of" };

export const agentRoutes = new Elysia({ prefix: "/api/agents" })
  .get("/", () => Promise.all(AGENTS.map(agentStatus)))
  .post(
    "/:id/task",
    async ({ params, body }) => {
      const a = requireAgent(params.id);
      const action = body.action;
      const script =
        action === "login" ? a.login.command : action === "logout" ? a.logout : installScript(a, action);
      return runTask({
        task: `agent:${a.id}`,
        label: `${ACTION_LABEL[action]} ${a.name}`,
        script,
        env: action === "login" ? { ...agentEnv(a), ...a.login.env } : agentEnv(a),
      });
    },
    { body: t.Object({ action: t.UnionEnum(TASK_ACTIONS) }) },
  )
  .put(
    "/:id",
    async ({ params, body }) => {
      const a = requireAgent(params.id);
      if (body.defaultPermission !== undefined) {
        if (!a.permissionModes.some((m) => m.id === body.defaultPermission)) throw new HttpError(400, "Unknown permission mode");
        setSetting(permSetting(a), body.defaultPermission);
      }
      if (body.apiKey !== undefined) {
        if (!a.apiKey) throw new HttpError(400, `${a.name} does not take an API key`);
        const key = body.apiKey?.trim() || null;
        setSetting(keySetting(a), key ?? "");
        await a.onApiKey?.(key);
        logActivity(key ? "api_key_set" : "api_key_removed", a.id);
      }
      return agentStatus(a);
    },
    {
      body: t.Object({
        defaultPermission: t.Optional(t.String({ maxLength: 64 })),
        apiKey: t.Optional(t.Nullable(t.String({ maxLength: 512 }))),
      }),
    },
  );
