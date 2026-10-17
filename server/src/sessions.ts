import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Elysia, t } from "elysia";
import { agentEnv, binPath, getAgent, permissionArgs, type AgentDef } from "./agents";
import { db, logActivity } from "./db";
import { exec, HttpError } from "./exec";
import { isDir, projectDir, projectRoot, workspaceId } from "./paths";
import {
  capture,
  findRemoteUrl,
  hasSession,
  killSession,
  listSessions,
  newSession,
  respawn,
  setOption,
  stopSession,
  tailLines,
} from "./tmux";
import { createWorktree } from "./worktrees";

/** A session runs an agent from AGENTS (by id), Claude remote control ("rc"), or a plain shell ("bash"). */
export type Mode = string;
/** Remote control: on-demand sessions share the folder, or each gets its own git worktree. */
export const SPAWN_MODES = ["same-dir", "worktree"] as const;

const IDLE_AFTER_MS = 15_000;

export function sessionAgent(mode: Mode): AgentDef | null {
  if (mode === "bash") return null;
  const agent = getAgent(mode === "rc" ? "claude" : mode);
  if (!agent) throw new HttpError(400, `Unknown session type "${mode}"`);
  return agent;
}

export function buildCommand(
  mode: Mode,
  opts: { permission?: string; name?: string; resume?: boolean; spawn?: string },
): string[] {
  const agent = sessionAgent(mode);
  if (!agent) return ["bash", "-l"];
  // Always explicit when chosen: otherwise the agent falls back to its own configured default.
  const perm = permissionArgs(agent, opts.permission);
  if (mode !== "rc") return agent.launch({ resume: opts.resume, permissionArgs: perm });
  // --continue reattaches to the remote-control session last recorded for this directory.
  return opts.resume
    ? ["claude", "remote-control", "--continue"]
    : [
        "claude",
        "remote-control",
        ...(opts.name ? ["--name", opts.name] : []),
        "--spawn",
        opts.spawn ?? "same-dir",
        ...perm,
      ];
}

interface ProcInfo {
  pid: number;
  ppid: number;
  cpu: number;
  rssKb: number;
}

async function processTable(): Promise<ProcInfo[]> {
  const r = await exec(["ps", "-eo", "pid=,ppid=,pcpu=,rss="]);
  return r.stdout
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number))
    .map(([pid, ppid, cpu, rss]) => ({ pid: pid!, ppid: ppid!, cpu: cpu!, rssKb: rss! }));
}

/** CPU% and RSS of a process and all its descendants. */
export function treeUsage(procs: ProcInfo[], root: number) {
  const children = new Map<number, ProcInfo[]>();
  for (const p of procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p]);
  let cpu = 0;
  let rssKb = 0;
  const stack = procs.filter((p) => p.pid === root);
  while (stack.length) {
    const p = stack.pop()!;
    cpu += p.cpu;
    rssKb += p.rssKb;
    stack.push(...(children.get(p.pid) ?? []));
  }
  return { cpu: Math.round(cpu * 10) / 10, memMB: Math.round(rssKb / 1024) };
}

export async function sessionList(project?: string) {
  const [sessions, procs] = await Promise.all([listSessions(), processTable()]);
  const live = new Set(sessions.map((s) => s.name));

  // Sessions the DB thinks are running but tmux no longer has (e.g. container was recreated).
  const open = db.query<{ name: string }, []>("SELECT name FROM sessions WHERE ended_at IS NULL").all();
  for (const { name } of open) {
    if (!live.has(name)) db.query("UPDATE sessions SET ended_at = ? WHERE name = ?").run(Date.now(), name);
  }

  const now = Date.now();
  const filtered = sessions.filter((s) => s.project && !s.task && (!project || s.project === project));
  return Promise.all(
    filtered.map(async (s) => {
      const text = await capture(s.name, s.mode === "rc" ? 300 : 40);
      return {
        name: s.name,
        project: s.project,
        mode: s.mode,
        permission: s.permission,
        worktree: s.worktree || null,
        label: s.label,
        created: s.created,
        activity: s.activity,
        attached: s.attached,
        status: (s.dead ? "exited" : now - s.activity < IDLE_AFTER_MS ? "active" : "idle") as "exited" | "active" | "idle",
        exitStatus: s.exitStatus,
        preview: tailLines(text, 6),
        remoteUrl: s.mode === "rc" ? findRemoteUrl(text) : null,
        ...(s.dead ? { cpu: 0, memMB: 0 } : treeUsage(procs, s.pid)),
      };
    }),
  );
}

export type SessionInfo = Awaited<ReturnType<typeof sessionList>>[number];

/**
 * `claude remote-control` re-adopts the session recorded in bridge-pointer.json even without --continue.
 * If that session was archived from claude.ai or the mobile app, the pre-created session fails right
 * away ("Session failed: Process exited with error"), so a fresh start drops the pointer first.
 */
async function forgetRemoteSession(cwd: string) {
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(process.env.HOME ?? "/root", ".claude");
  await rm(join(configDir, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), "bridge-pointer.json"), { force: true });
}

export async function startSession(input: {
  project: string;
  mode: Mode;
  permission?: string;
  label?: string;
  resume?: boolean;
  spawn?: string;
  /** Run in this existing worktree of the project. */
  worktree?: string;
  /** Create a worktree first and run the session in it. */
  newWorktree?: { name: string; branch?: string; base?: string };
}) {
  if (!(await isDir(projectRoot(input.project)))) throw new HttpError(404, "Project not found");
  const agent = sessionAgent(input.mode);
  if (agent && !binPath(agent)) throw new HttpError(400, `${agent.name} is not installed yet. Install it in Settings.`);
  if (agent && input.permission && !agent.permissionModes.some((m) => m.id === input.permission)) {
    throw new HttpError(400, `Unknown permission mode for ${agent.name}`);
  }
  // Validate everything else before creating a worktree, so a bad request leaves nothing behind.
  const worktree = input.newWorktree
    ? (await createWorktree(input.project, input.newWorktree)).name
    : input.worktree || null;
  const cwd = projectDir(workspaceId(input.project, worktree));
  if (!(await isDir(cwd))) throw new HttpError(404, "Worktree not found");
  const name = `hub-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const label = input.label?.trim() || worktree || input.project;
  const command = buildCommand(input.mode, {
    permission: input.permission,
    name: label,
    resume: input.resume,
    spawn: input.spawn,
  });
  if (input.mode === "rc" && !input.resume) await forgetRemoteSession(cwd);
  await newSession({
    name,
    cwd,
    command,
    env: agent ? agentEnv(agent) : undefined,
    options: {
      project: input.project,
      mode: input.mode,
      perm: input.permission ?? "default",
      label,
      cmd: command.join(" "),
      wt: worktree ?? "",
    },
  });
  db.query(
    "INSERT INTO sessions (name, project, mode, permission, label, started_at, worktree) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(name, input.project, input.mode, input.permission ?? "default", label, Date.now(), worktree);
  logActivity("session_start", `${workspaceId(input.project, worktree)} ${input.mode}${input.resume ? " (resume)" : ""}`);
  return { name };
}

async function requireSession(name: string) {
  if (!/^hub-[a-z0-9]+$/.test(name) || !(await hasSession(name))) throw new HttpError(404, "Session not found");
  const s = (await listSessions()).find((x) => x.name === name);
  if (!s?.project) throw new HttpError(404, "Session not found");
  return s;
}

export const sessionRoutes = new Elysia({ prefix: "/api/sessions" })
  .get("/", ({ query }) => sessionList(query.project), { query: t.Object({ project: t.Optional(t.String()) }) })
  .get(
    "/history",
    ({ query }) =>
      db
        .query<
          {
            name: string;
            project: string;
            mode: Mode;
            permission: string;
            label: string;
            started_at: number;
            ended_at: number;
            worktree: string | null;
          },
          [string, string]
        >(
          "SELECT * FROM sessions WHERE ended_at IS NOT NULL AND (? = '' OR project = ?) ORDER BY ended_at DESC LIMIT 20",
        )
        .all(query.project ?? "", query.project ?? ""),
    { query: t.Object({ project: t.Optional(t.String()) }) },
  )
  .post("/", ({ body }) => startSession(body), {
    body: t.Object({
      project: t.String(),
      mode: t.String({ maxLength: 32 }),
      permission: t.Optional(t.String({ maxLength: 64 })),
      label: t.Optional(t.String({ maxLength: 60 })),
      resume: t.Optional(t.Boolean()),
      spawn: t.Optional(t.UnionEnum(SPAWN_MODES)),
      worktree: t.Optional(t.String({ maxLength: 64 })),
      newWorktree: t.Optional(
        t.Object({
          name: t.String({ minLength: 1, maxLength: 64 }),
          branch: t.Optional(t.String({ maxLength: 200 })),
          base: t.Optional(t.String({ maxLength: 200 })),
        }),
      ),
    }),
  })
  .post("/:name/restart", async ({ params }) => {
    const s = await requireSession(params.name);
    const cwd = projectDir(workspaceId(s.project, s.worktree));
    // Restarting an agent session continues the previous conversation instead of starting blank.
    const agent = sessionAgent(s.mode);
    const command = buildCommand(s.mode, { permission: s.permission, name: s.label, resume: !!agent });
    await respawn(s.name, cwd, command, agent ? agentEnv(agent) : undefined);
    await setOption(s.name, "cmd", command.join(" "));
    logActivity("session_restart", `${s.project} ${s.mode}`);
    return { ok: true };
  })
  /** Plain-text scrollback for the "copy text" view (xterm.js only holds the visible screen). */
  .get(
    "/:name/capture",
    async ({ params, query }) => {
      await requireSession(params.name);
      const lines = Math.max(50, Math.min(50_000, query.lines ?? 3000));
      return { text: (await capture(params.name, lines)).replace(/\s+$/, "") };
    },
    { query: t.Object({ lines: t.Optional(t.Numeric()) }) },
  )
  .patch(
    "/:name",
    async ({ params, body }) => {
      await requireSession(params.name);
      await setOption(params.name, "label", body.label);
      db.query("UPDATE sessions SET label = ? WHERE name = ?").run(body.label, params.name);
      return { ok: true };
    },
    { body: t.Object({ label: t.String({ minLength: 1, maxLength: 60 }) }) },
  )
  .delete("/:name", async ({ params }) => {
    const s = await requireSession(params.name);
    if (s.mode === "rc" && !s.dead) await stopSession(s.name, s.pid);
    else await killSession(s.name);
    db.query("UPDATE sessions SET ended_at = ? WHERE name = ?").run(Date.now(), s.name);
    logActivity("session_kill", `${s.project} ${s.mode}`);
    return { ok: true };
  });
