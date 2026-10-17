import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Elysia, t } from "elysia";
import { logActivity } from "./db";
import { exec, HttpError } from "./exec";
import { git, GIT_ENV, gitSummary } from "./git";
import { isDir, PROJECTS_DIR, projectRoot, projectWorktreesDir, TRASH_DIR, validateName } from "./paths";
import { listSessions } from "./tmux";
import { worktreeCount } from "./worktrees";

async function exists(p: string) {
  return stat(p).then(
    () => true,
    () => false,
  );
}

export async function listProjects() {
  const entries = await readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => []);
  const sessions = await listSessions();
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
  const projects = await Promise.all(
    dirs.map(async (e) => {
      const dir = join(PROJECTS_DIR, e.name);
      const [st, summary, worktrees] = await Promise.all([stat(dir), gitSummary(dir), worktreeCount(e.name)]);
      const own = sessions.filter((s) => s.project === e.name);
      return {
        name: e.name,
        modified: st.mtimeMs,
        git: summary,
        worktrees,
        sessions: { total: own.length, running: own.filter((s) => !s.dead).length },
      };
    }),
  );
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

async function assertNoSessions(project: string) {
  const running = (await listSessions()).filter((s) => s.project === project);
  if (running.length) {
    throw new HttpError(409, `${running.length} session(s) still running in this project. Stop them first.`);
  }
}

/** Derive a folder name from a clone URL: git@github.com:a/b.git -> b */
export function repoName(url: string) {
  return url.replace(/\/+$/, "").replace(/\.git$/, "").split(/[/:]/).pop() ?? "";
}

export async function createProject(input: { name?: string; type: "empty" | "git-init" | "clone"; url?: string }) {
  if (input.type === "clone") {
    const url = input.url?.trim() ?? "";
    if (!/^(https?:\/\/|ssh:\/\/|git@)[^\s]+$/.test(url)) throw new HttpError(400, "Invalid repository URL");
    const name = validateName(input.name?.trim() || repoName(url));
    const dir = projectRoot(name);
    if (await exists(dir)) throw new HttpError(409, "A project with this name already exists");
    const r = await exec(["git", "clone", "--", url, dir], { env: GIT_ENV, timeoutMs: 10 * 60_000 });
    if (r.code !== 0) {
      await rm(dir, { recursive: true, force: true });
      throw new HttpError(400, `git clone failed: ${r.stderr.trim().split("\n").slice(-3).join(" ")}`);
    }
    logActivity("project_clone", `${name} ← ${url}`);
    return { name };
  }
  const name = validateName(input.name?.trim() ?? "");
  const dir = projectRoot(name);
  if (await exists(dir)) throw new HttpError(409, "A project with this name already exists");
  await mkdir(dir);
  if (input.type === "git-init") await exec(["git", "init", "-q", "-b", "main"], { cwd: dir });
  logActivity("project_create", `${name} (${input.type})`);
  return { name };
}

export async function renameProject(from: string, to: string) {
  const src = projectRoot(from);
  const dst = projectRoot(validateName(to));
  if (!(await isDir(src))) throw new HttpError(404, "Project not found");
  if (await exists(dst)) throw new HttpError(409, "That name is already taken");
  await assertNoSessions(from);
  await rename(src, dst);
  // Worktrees move along; git keeps absolute paths in both directions, so repair them afterwards.
  const wtFrom = projectWorktreesDir(from);
  if (await isDir(wtFrom)) {
    const wtTo = projectWorktreesDir(to);
    await rename(wtFrom, wtTo);
    const dirs = (await readdir(wtTo, { withFileTypes: true })).filter((e) => e.isDirectory());
    if (dirs.length) await git(dst, "worktree", "repair", ...dirs.map((e) => join(wtTo, e.name)));
  }
  logActivity("project_rename", `${from} → ${to}`);
  return { name: to };
}

export async function trashProject(name: string) {
  const src = projectRoot(name);
  if (!(await isDir(src))) throw new HttpError(404, "Project not found");
  await assertNoSessions(name);
  const worktrees = await worktreeCount(name);
  if (worktrees) throw new HttpError(409, `This project has ${worktrees} worktree(s). Remove them first.`);
  await mkdir(TRASH_DIR, { recursive: true });
  const id = `${name}__${Date.now()}`;
  await rename(src, join(TRASH_DIR, id));
  logActivity("project_trash", name);
  return { id };
}

export async function listTrash() {
  const entries = await readdir(TRASH_DIR, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const i = e.name.lastIndexOf("__");
      return { id: e.name, name: e.name.slice(0, i), deletedAt: Number(e.name.slice(i + 2)) };
    })
    .sort((a, b) => b.deletedAt - a.deletedAt);
}

function trashPath(id: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*__\d+$/.test(id)) throw new HttpError(400, "Invalid trash ID");
  return join(TRASH_DIR, id);
}

export async function restoreTrash(id: string, as?: string) {
  const src = trashPath(id);
  if (!(await isDir(src))) throw new HttpError(404, "Trash item not found");
  const name = validateName(as?.trim() || id.slice(0, id.lastIndexOf("__")));
  const dst = projectRoot(name);
  if (await exists(dst)) throw new HttpError(409, `Project "${name}" already exists; restore it under another name`);
  await rename(src, dst);
  logActivity("project_restore", name);
  return { name };
}

export async function purgeTrash(id: string) {
  const src = trashPath(id);
  await rm(src, { recursive: true, force: true });
  logActivity("project_purge", id);
  return { ok: true };
}

export const projectRoutes = new Elysia({ prefix: "/api/projects" })
  .get("/", () => listProjects())
  .post("/", ({ body }) => createProject(body), {
    body: t.Object({
      name: t.Optional(t.String({ maxLength: 64 })),
      type: t.Union([t.Literal("empty"), t.Literal("git-init"), t.Literal("clone")]),
      url: t.Optional(t.String({ maxLength: 1000 })),
    }),
  })
  .patch("/:project", ({ params, body }) => renameProject(params.project, body.name), {
    body: t.Object({ name: t.String({ maxLength: 64 }) }),
  })
  .delete("/:project", ({ params }) => trashProject(params.project))
  .get("/trash/list", () => listTrash())
  .post("/trash/:id/restore", ({ params, body }) => restoreTrash(params.id, body?.name), {
    body: t.Optional(t.Object({ name: t.Optional(t.String({ maxLength: 64 })) })),
  })
  .delete("/trash/:id", ({ params }) => purgeTrash(params.id));
