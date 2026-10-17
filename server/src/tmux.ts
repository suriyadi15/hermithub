import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exec } from "./exec";
import { DATA_DIR } from "./paths";

/** Dedicated tmux server so hub sessions never mix with a user's own tmux. */
export const TMUX_SOCKET = process.env.HUB_TMUX_SOCKET ?? "hub";
/** tmux escapes control characters in -F output, so use a printable separator. */
const SEP = "||hub||";

export const TMUX_CONF = [
  "set -g status off",
  // Wheel and touch scrolling are handled by the web client (see scroll()), so the mouse stays with
  // xterm.js and plain drag-to-select works.
  "set -g mouse off",
  "set -g history-limit 50000",
  "set -sg escape-time 0",
  "set -g focus-events on",
  "set -g default-terminal tmux-256color",
  "set -ga terminal-overrides ',xterm-256color:Tc'",
  "set -g window-size latest",
  "set -g aggressive-resize on",
  "set -g remain-on-exit on",
  "set -g set-clipboard on",
  "set -g allow-passthrough on",
];

/** Only read when the tmux server starts, so every session gets the same settings. */
const CONF_PATH = join(DATA_DIR, "tmux.conf");
mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(CONF_PATH, TMUX_CONF.join("\n") + "\n");

export function tmuxArgs(...args: string[]) {
  return ["tmux", "-L", TMUX_SOCKET, "-f", CONF_PATH, ...args];
}

export function tmux(...args: string[]) {
  return exec(tmuxArgs(...args));
}

export interface TmuxSession {
  name: string;
  created: number;
  activity: number;
  attached: number;
  dead: boolean;
  exitStatus: number | null;
  pid: number;
  project: string;
  mode: string;
  permission: string;
  label: string;
  command: string;
  /** Set on system tasks (agent install/login, GitHub login, ...), which have no project. */
  task: string;
  /** Worktree of the project the session runs in, "" for the project folder itself. */
  worktree: string;
}

const FORMAT = [
  "#{session_name}",
  "#{session_created}",
  "#{window_activity}",
  "#{session_attached}",
  "#{pane_dead}",
  "#{pane_dead_status}",
  "#{pane_pid}",
  "#{@hub_project}",
  "#{@hub_mode}",
  "#{@hub_perm}",
  "#{@hub_label}",
  "#{@hub_cmd}",
  "#{@hub_task}",
  "#{@hub_wt}",
].join(SEP);

export function parseSessions(out: string): TmuxSession[] {
  return out
    .split("\n")
    .filter((l) => l.startsWith("hub-"))
    .map((line) => {
      const [name, created, activity, attached, dead, deadStatus, pid, project, mode, permission, label, command, task, worktree] =
        line.split(SEP);
      return {
        name: name!,
        created: Number(created) * 1000,
        activity: Number(activity) * 1000,
        attached: Number(attached),
        dead: dead === "1",
        exitStatus: deadStatus ? Number(deadStatus) : null,
        pid: Number(pid),
        project: project ?? "",
        mode: mode ?? "",
        permission: permission ?? "",
        label: label ?? "",
        command: command ?? "",
        task: task ?? "",
        worktree: worktree ?? "",
      };
    });
}

export async function listSessions(): Promise<TmuxSession[]> {
  const r = await tmux("list-sessions", "-F", FORMAT);
  if (r.code !== 0) return []; // "no server running" when nothing has been started yet
  return parseSessions(r.stdout);
}

export async function hasSession(name: string) {
  return (await tmux("has-session", "-t", `=${name}`)).code === 0;
}

export async function newSession(opts: {
  name: string;
  cwd: string;
  command: string[];
  options: Record<string, string>;
  env?: Record<string, string>;
}) {
  const r = await tmux(
    "new-session",
    "-d",
    "-s",
    opts.name,
    "-x",
    "160",
    "-y",
    "45",
    "-c",
    opts.cwd,
    "-e",
    "TERM=xterm-256color",
    "-e",
    "COLORTERM=truecolor",
    ...envArgs(opts.env),
    "--",
    ...opts.command,
  );
  if (r.code !== 0) throw new Error(`tmux: ${r.stderr.trim()}`);
  for (const [k, v] of Object.entries(opts.options)) await tmux("set-option", "-t", opts.name, `@hub_${k}`, v);
}

function envArgs(env: Record<string, string> = {}) {
  return Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
}

export async function respawn(name: string, cwd: string, command: string[], env?: Record<string, string>) {
  const r = await tmux("respawn-pane", "-k", "-t", `=${name}:`, "-c", cwd, ...envArgs(env), "--", ...command);
  if (r.code !== 0) throw new Error(`tmux: ${r.stderr.trim()}`);
  await tmux("clear-history", "-t", `=${name}:`);
}

export async function killSession(name: string) {
  await tmux("kill-session", "-t", `=${name}`);
}

/**
 * kill-session sends SIGHUP, which makes `claude remote-control` exit without closing its sessions,
 * so claude.ai and the mobile app keep showing them as connected. SIGINT lets it shut them down first.
 */
export async function stopSession(name: string, pid: number, timeoutMs = 10_000) {
  if (pid > 0) {
    try {
      process.kill(pid, "SIGINT");
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const r = await tmux("display-message", "-p", "-t", `=${name}:`, "#{pane_dead}");
        if (r.code !== 0 || r.stdout.trim() === "1") break;
        await Bun.sleep(250);
      }
    } catch {
      // Already gone.
    }
  }
  await killSession(name);
}

export async function setOption(name: string, key: string, value: string) {
  await tmux("set-option", "-t", `=${name}`, `@hub_${key}`, value);
}

export type ScrollDir = "up" | "down" | "exit";

/** SGR mouse-wheel report (button 64 = up, 65 = down), repeated n times. */
export function wheelSeq(dir: "up" | "down", n: number) {
  return (dir === "up" ? "\x1b[<64;1;1M" : "\x1b[<65;1;1M").repeat(n);
}

/** Parse a client scroll request: {"dir":"up"|"down"|"exit","lines":n}; lines clamped to 1–200. */
export function parseScrollFrame(text: string): { dir: ScrollDir; lines: number } | null {
  try {
    const { dir, lines } = JSON.parse(text);
    if (dir !== "up" && dir !== "down" && dir !== "exit") return null;
    const n = Math.floor(Number(lines));
    return { dir, lines: Number.isFinite(n) ? Math.max(1, Math.min(200, n)) : 1 };
  } catch {
    return null;
  }
}

export async function paneState(name: string) {
  const r = await tmux("display-message", "-p", "-t", `=${name}:`, "#{pane_in_mode} #{alternate_on} #{mouse_any_flag}");
  const [inMode, alt, mouse] = r.stdout.trim().split(" ");
  return { inMode: inMode === "1", alternate: alt === "1", mouse: mouse === "1" };
}

/**
 * Scroll a pane's history by `lines`. Normal panes (bash, Claude's inline UI) use tmux copy-mode;
 * `-e` leaves it again once scrolled back to the bottom. Full-screen apps (alternate screen) keep
 * their own history, so they get wheel events if they asked for mouse input, else arrow keys.
 * Returns whether the pane is in copy-mode afterwards.
 */
export async function scroll(name: string, dir: ScrollDir, lines = 1): Promise<boolean> {
  const target = `=${name}:`;
  if (dir === "exit") {
    await tmux("send-keys", "-t", target, "-X", "cancel");
    return false;
  }
  const st = await paneState(name);
  if (st.alternate && !st.inMode) {
    if (st.mouse) await tmux("send-keys", "-t", target, "-l", wheelSeq(dir, lines));
    else await tmux("send-keys", "-t", target, "-N", String(lines), dir === "up" ? "Up" : "Down");
    return false;
  }
  if (!st.inMode) {
    if (dir === "down") return false;
    await tmux("copy-mode", "-e", "-t", target);
  }
  await tmux("send-keys", "-t", target, "-X", "-N", String(lines), dir === "up" ? "scroll-up" : "scroll-down");
  return (await paneState(name)).inMode;
}

/** Push TMUX_CONF into an already running tmux server (it only reads the file when starting). */
export async function applyGlobalOptions() {
  for (const line of TMUX_CONF) {
    if (/^set -\w*a/.test(line)) continue; // appending options would pile up on every restart
    const args = line.split(" ").map((a) => a.replace(/^'(.*)'$/, "$1"));
    await tmux(...args);
  }
}

/** Last `lines` lines of the pane as plain text (wrapped lines joined). */
export async function capture(name: string, lines = 40) {
  const r = await tmux("capture-pane", "-p", "-J", "-t", `=${name}:`, "-S", `-${lines}`);
  return r.code === 0 ? r.stdout : "";
}

/** Strip trailing blank lines and return the last non-empty `n` lines. */
export function tailLines(text: string, n: number) {
  const lines = text.replace(/\s+$/, "").split("\n");
  return lines.slice(-n).join("\n");
}

export function findRemoteUrl(text: string): string | null {
  const m = text.match(/https:\/\/claude\.ai\/code[^\s"'<>)\]]*/g);
  return m ? m[m.length - 1]! : null;
}

/** Last URL and one-time code (e.g. GitHub's ABCD-1234) printed by a login flow, so the UI can show them as buttons. */
export function findLoginHints(text: string): { url: string | null; code: string | null } {
  const urls = text.match(/https?:\/\/[^\s"'<>)\]]+/g);
  const codes = text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,5}\b/g);
  return { url: urls ? urls[urls.length - 1]! : null, code: codes ? codes[codes.length - 1]! : null };
}
