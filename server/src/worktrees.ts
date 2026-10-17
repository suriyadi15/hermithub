import { readdir, rmdir, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { Elysia, t } from "elysia";
import { logActivity } from "./db";
import { HttpError } from "./exec";
import { checkBranchName, git, gitSummary, run } from "./git";
import { isDir, projectRoot, projectWorktreesDir, validateName, worktreeDir } from "./paths";
import { listSessions } from "./tmux";

/**
 * Worktrees let one project run several tasks at once: each gets its own folder and branch while
 * sharing the project's .git. They live in WORKTREES_DIR/<project>/<name>, and every route that takes
 * a project also accepts the workspace id "<project>@<name>" (see projectDir).
 */

export interface WorktreeEntry {
  path: string;
  head: string;
  /** Short branch name, null when detached. */
  branch: string | null;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

/** Parse `git worktree list --porcelain`. */
export function parseWorktrees(out: string): WorktreeEntry[] {
  return out
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").filter(Boolean))
    .filter((lines) => lines[0]?.startsWith("worktree "))
    .map((lines) => {
      const field = (key: string) => lines.find((l) => l === key || l.startsWith(key + " "));
      const value = (key: string) => field(key)?.slice(key.length + 1) ?? "";
      const ref = value("branch");
      return {
        path: value("worktree"),
        head: value("HEAD"),
        branch: ref ? ref.replace(/^refs\/heads\//, "") : null,
        bare: !!field("bare"),
        locked: !!field("locked"),
        prunable: !!field("prunable"),
      };
    });
}

/** Number of worktree folders a project has (cheap: no git call). */
export async function worktreeCount(project: string) {
  try {
    const entries = await readdir(projectWorktreesDir(project), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).length;
  } catch {
    return 0; // no worktrees yet, or a folder name the hub cannot address
  }
}

async function entries(root: string) {
  await git(root, "worktree", "prune");
  const r = await git(root, "worktree", "list", "--porcelain");
  return r.code === 0 ? parseWorktrees(r.stdout) : null;
}

export async function listWorktrees(project: string) {
  const root = projectRoot(project);
  if (!(await isDir(root))) throw new HttpError(404, "Project not found");
  const list = await entries(root);
  if (!list) return { repo: false as const, main: null, worktrees: [] };
  const base = projectWorktreesDir(project);
  const sessions = (await listSessions()).filter((s) => s.project === project && !s.task);
  const describe = async (e: WorktreeEntry, name: string | null) => {
    const own = sessions.filter((s) => s.worktree === (name ?? ""));
    return {
      name,
      path: e.path,
      branch: e.branch,
      head: e.head.slice(0, 8),
      locked: e.locked,
      git: await gitSummary(e.path),
      sessions: { total: own.length, running: own.filter((s) => !s.dead).length },
    };
  };
  const main = list[0]!;
  const ours = list.filter((e) => dirname(e.path) === base && !e.prunable);
  return {
    repo: true as const,
    main: await describe(main, null),
    worktrees: await Promise.all(ours.map((e) => describe(e, basename(e.path)))),
  };
}

export type WorktreeList = Awaited<ReturnType<typeof listWorktrees>>;

export async function createWorktree(project: string, input: { name: string; branch?: string; base?: string }) {
  const root = projectRoot(project);
  if (!(await isDir(root))) throw new HttpError(404, "Project not found");
  if ((await git(root, "rev-parse", "--git-dir")).code !== 0) {
    throw new HttpError(400, "This project is not a git repository");
  }
  if ((await git(root, "rev-parse", "--verify", "-q", "HEAD")).code !== 0) {
    throw new HttpError(400, "Make a first commit before creating worktrees");
  }
  const name = validateName(input.name.trim());
  const dir = worktreeDir(project, name);
  if (await stat(dir).then(() => true, () => false)) throw new HttpError(409, `Worktree "${name}" already exists`);
  const branch = checkBranchName(input.branch?.trim() || name);
  const exists = (await git(root, "rev-parse", "--verify", "-q", `refs/heads/${branch}`)).code === 0;
  const base = !exists && input.base?.trim() ? checkBranchName(input.base.trim()) : null;
  if (base && (await git(root, "rev-parse", "--verify", "-q", `${base}^{commit}`)).code !== 0) {
    throw new HttpError(400, `Unknown branch, tag or commit: ${base}`);
  }
  // An existing branch is checked out as is (git refuses if another worktree already has it).
  const args = exists ? ["worktree", "add", dir, branch] : ["worktree", "add", "-b", branch, dir, ...(base ? [base] : [])];
  const output = await run(root, args, 120_000);
  logActivity("worktree_add", `${project}@${name} (${branch})`);
  return { name, branch, output };
}

export async function removeWorktree(project: string, name: string, opts: { force?: boolean; deleteBranch?: boolean }) {
  const root = projectRoot(project);
  validateName(name);
  const dir = worktreeDir(project, name);
  const own = (await listSessions()).filter((s) => s.project === project && s.worktree === name);
  if (own.length) throw new HttpError(409, `${own.length} session(s) still running in this worktree. Stop them first.`);
  const entry = (await entries(root))?.find((e) => e.path === dir);
  if (!entry) throw new HttpError(404, "Worktree not found");
  const out = [await run(root, ["worktree", "remove", ...(opts.force ? ["--force"] : []), dir])];
  let branchError: string | null = null;
  if (opts.deleteBranch && entry.branch) {
    try {
      out.push(await run(root, ["branch", opts.force ? "-D" : "-d", entry.branch]));
    } catch (e) {
      // The worktree is gone already; report why the branch stayed (usually: not merged yet).
      branchError = (e as Error).message;
    }
  }
  await rmdir(projectWorktreesDir(project)).catch(() => {}); // only succeeds once it is empty
  logActivity("worktree_remove", `${project}@${name}`);
  return { ok: true, output: out.filter(Boolean).join("\n"), branchError };
}

export const worktreeRoutes = new Elysia({ prefix: "/api/projects/:project/worktrees" })
  .get("/", ({ params }) => listWorktrees(params.project))
  .post("/", ({ params, body }) => createWorktree(params.project, body), {
    body: t.Object({
      name: t.String({ minLength: 1, maxLength: 64 }),
      branch: t.Optional(t.String({ maxLength: 200 })),
      base: t.Optional(t.String({ maxLength: 200 })),
    }),
  })
  .delete(
    "/:name",
    ({ params, query }) => removeWorktree(params.project, params.name, query),
    { query: t.Object({ force: t.Optional(t.BooleanString()), deleteBranch: t.Optional(t.BooleanString()) }) },
  );
