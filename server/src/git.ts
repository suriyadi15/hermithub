import { Elysia, t } from "elysia";
import { logActivity } from "./db";
import { exec, HttpError } from "./exec";
import { resolveInProject } from "./files";
import { projectDir } from "./paths";

export const GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
};

const NETWORK_TIMEOUT = 120_000;

export function git(cwd: string, ...args: string[]) {
  return gitT(cwd, 15_000, ...args);
}

function gitT(cwd: string, timeoutMs: number, ...args: string[]) {
  return exec(["git", "-c", "safe.directory=*", "-c", "color.ui=never", ...args], { cwd, env: GIT_ENV, timeoutMs });
}

/** Run a git command that must succeed; its output (stdout + stderr) goes back to the UI. */
export async function run(cwd: string, args: string[], timeoutMs = 30_000) {
  const r = await gitT(cwd, timeoutMs, ...args);
  const output = [r.stdout, r.stderr].map((s) => s.trim()).filter(Boolean).join("\n");
  if (r.code !== 0) throw new HttpError(400, output || `git ${args[0]} failed (exit ${r.code})`);
  return output;
}

export interface GitSummary {
  branch: string;
  dirty: number;
  ahead: number;
  behind: number;
  lastCommit: { hash: string; subject: string; date: number } | null;
}

export interface StatusFile {
  /** Two-letter porcelain code, e.g. " M", "A ", "??". */
  status: string;
  index: string;
  worktree: string;
  path: string;
  /** Original path of a rename/copy. */
  orig?: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflict: boolean;
}

const CONFLICT = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function statusFile(xy: string, path: string, orig?: string): StatusFile {
  const [x, y] = [xy[0] ?? " ", xy[1] ?? " "];
  const untracked = xy === "??";
  const conflict = CONFLICT.has(xy);
  return {
    status: xy,
    index: x,
    worktree: y,
    path,
    ...(orig ? { orig } : {}),
    staged: !untracked && !conflict && x !== " " && x !== "!",
    unstaged: untracked || conflict || y !== " ",
    untracked,
    conflict,
  };
}

/** Parse `git status --porcelain=v1 -b`, NUL-separated (`-z`) or newline-separated. */
export function parseStatus(out: string) {
  const z = out.includes("\0");
  const entries = out.split(z ? "\0" : "\n");
  const head = entries[0]?.startsWith("## ") ? entries.shift()!.slice(3) : "";
  const detached = head.startsWith("HEAD (no branch)");
  const branch = detached ? "HEAD" : head.replace(/^No commits yet on /, "").split("...")[0]!.trim();
  const upstream = head.includes("...") ? head.split("...")[1]!.split(" ")[0]! : null;
  const ahead = Number(head.match(/ahead (\d+)/)?.[1] ?? 0);
  const behind = Number(head.match(/behind (\d+)/)?.[1] ?? 0);
  const files: StatusFile[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.length < 4) continue;
    const xy = e.slice(0, 2);
    if (z) {
      // -z: a rename/copy is followed by its original path as a separate entry.
      const orig = xy[0] === "R" || xy[0] === "C" ? entries[++i] : undefined;
      files.push(statusFile(xy, e.slice(3), orig));
    } else {
      const [orig, path] = e.slice(3).includes(" -> ") ? e.slice(3).split(" -> ") : [undefined, e.slice(3)];
      files.push(statusFile(xy, path!, orig));
    }
  }
  return { branch, detached, upstream, ahead, behind, files };
}

export async function gitSummary(dir: string): Promise<GitSummary | null> {
  const st = await git(dir, "status", "--porcelain=v1", "-b", "-z");
  if (st.code !== 0) return null;
  const { branch, ahead, behind, files } = parseStatus(st.stdout);
  const log = await git(dir, "log", "-1", "--format=%h%x1f%s%x1f%ct");
  const [hash, subject, date] = log.code === 0 ? log.stdout.trim().split("\x1f") : [];
  return {
    branch,
    dirty: files.length,
    ahead,
    behind,
    lastCommit: hash ? { hash, subject: subject ?? "", date: Number(date) * 1000 } : null,
  };
}

export interface Branch {
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  date: number;
  subject: string;
}

export const BRANCH_FORMAT = "%(refname)%1f%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track)%1f%(committerdate:unix)%1f%(contents:subject)";

export function parseBranches(out: string): Branch[] {
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\x1f"))
    .filter(([ref]) => !ref!.endsWith("/HEAD"))
    .map(([ref, name, head, upstream, track, date, subject]) => ({
      name: name!,
      remote: ref!.startsWith("refs/remotes/"),
      current: head === "*",
      upstream: upstream || null,
      ahead: Number(track?.match(/ahead (\d+)/)?.[1] ?? 0),
      behind: Number(track?.match(/behind (\d+)/)?.[1] ?? 0),
      date: Number(date) * 1000,
      subject: subject ?? "",
    }));
}

/** Validate repo-relative paths and turn them into literal pathspecs (no glob magic). */
function pathspecs(project: string, paths: string[]) {
  if (paths.length === 0) throw new HttpError(400, "No files selected");
  return paths.map((p) => {
    resolveInProject(project, p); // throws if it escapes the project
    return `:(literal)${p.replace(/^\/+/, "")}`;
  });
}

export function checkBranchName(name: string) {
  if (!name || name.startsWith("-") || /[\s~^:?*[\\]|\.\.|@\{|\.lock$|\/$|^\//.test(name)) {
    throw new HttpError(400, `Invalid branch name: ${name}`);
  }
  return name;
}

async function hasHead(dir: string) {
  return (await git(dir, "rev-parse", "--verify", "-q", "HEAD")).code === 0;
}

const paths = t.Union([t.Array(t.String(), { maxItems: 5000 }), t.Literal("all")]);

export const gitRoutes = new Elysia({ prefix: "/api/projects/:project/git" })
  .get("/", async ({ params }) => {
    const dir = projectDir(params.project);
    const st = await git(dir, "status", "--porcelain=v1", "-b", "-z", "-uall");
    if (st.code !== 0) return { repo: false as const };
    const status = parseStatus(st.stdout);
    const [log, remote, stash] = await Promise.all([
      git(dir, "log", "-50", "--format=%h%x1f%s%x1f%an%x1f%ct"),
      git(dir, "remote", "get-url", "origin"),
      git(dir, "stash", "list", "--format=%gd"),
    ]);
    const commits =
      log.code === 0
        ? log.stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((l) => {
              const [hash, subject, author, date] = l.split("\x1f");
              return { hash: hash!, subject: subject!, author: author!, date: Number(date) * 1000 };
            })
        : [];
    return {
      repo: true as const,
      ...status,
      remote: remote.stdout.trim() || null,
      stashCount: stash.code === 0 ? stash.stdout.split("\n").filter(Boolean).length : 0,
      commits,
    };
  })
  .get(
    "/diff",
    async ({ params, query }) => {
      const dir = projectDir(params.project);
      let out: string;
      if (query.untracked && query.path) {
        pathspecs(params.project, [query.path]);
        // Exit code 1 just means "files differ".
        out = (await git(dir, "diff", "--no-color", "--no-index", "--", "/dev/null", query.path)).stdout;
      } else {
        const args = query.path ? ["--", ...pathspecs(params.project, [query.path])] : [];
        out = (await git(dir, "diff", "--no-color", ...(query.staged ? ["--cached"] : []), ...args)).stdout;
      }
      return { diff: out.slice(0, 500_000) };
    },
    {
      query: t.Object({
        path: t.Optional(t.String()),
        staged: t.Optional(t.BooleanString()),
        untracked: t.Optional(t.BooleanString()),
      }),
    },
  )
  .get(
    "/show",
    async ({ params, query }) => {
      if (!/^[0-9a-f]{4,40}$/.test(query.hash)) throw new HttpError(400, "Invalid hash");
      const dir = projectDir(params.project);
      const out = await run(dir, ["show", "--no-color", "--stat", "--patch", "--format=fuller", query.hash]);
      return { diff: out.slice(0, 500_000) };
    },
    { query: t.Object({ hash: t.String() }) },
  )
  .get("/branches", async ({ params }) => {
    const dir = projectDir(params.project);
    const r = await git(dir, "for-each-ref", "--sort=-committerdate", `--format=${BRANCH_FORMAT}`, "refs/heads", "refs/remotes");
    return r.code === 0 ? parseBranches(r.stdout) : [];
  })
  .post(
    "/stage",
    async ({ params, body }) => {
      const dir = projectDir(params.project);
      const specs = body.paths === "all" ? ["."] : pathspecs(params.project, body.paths);
      return { ok: true, output: await run(dir, ["add", "-A", "--", ...specs]) };
    },
    { body: t.Object({ paths }) },
  )
  .post(
    "/unstage",
    async ({ params, body }) => {
      const dir = projectDir(params.project);
      const specs = body.paths === "all" ? ["."] : pathspecs(params.project, body.paths);
      // Before the first commit there is no HEAD to restore from: just drop the entries from the index.
      const args = (await hasHead(dir))
        ? ["restore", "--staged", "--", ...specs]
        : ["rm", "--cached", "-r", "-q", "--", ...specs];
      return { ok: true, output: await run(dir, args) };
    },
    { body: t.Object({ paths }) },
  )
  .post(
    "/discard",
    async ({ params, body }) => {
      const dir = projectDir(params.project);
      const st = parseStatus((await git(dir, "status", "--porcelain=v1", "-z", "-uall")).stdout);
      const wanted = body.paths === "all" ? null : new Set(body.paths);
      const files = st.files.filter((f) => f.unstaged && (!wanted || wanted.has(f.path)));
      const untracked = files.filter((f) => f.untracked).map((f) => f.path);
      // Files that are new in the index have nothing to restore to; leave those staged.
      const tracked = files.filter((f) => !f.untracked && f.index !== "A").map((f) => f.path);
      const out: string[] = [];
      if (tracked.length) out.push(await run(dir, ["restore", "--worktree", "--", ...pathspecs(params.project, tracked)]));
      if (untracked.length) out.push(await run(dir, ["clean", "-f", "-q", "--", ...pathspecs(params.project, untracked)]));
      return { ok: true, output: out.filter(Boolean).join("\n") };
    },
    { body: t.Object({ paths }) },
  )
  .post(
    "/commit",
    async ({ params, body }) => {
      const dir = projectDir(params.project);
      if (body.all) await run(dir, ["add", "-A"]);
      const args = ["commit", "-m", body.message];
      if (body.amend) args.push("--amend");
      const output = await run(dir, args);
      logActivity("git_commit", `${params.project}: ${body.message.split("\n")[0]}`);
      return { ok: true, output };
    },
    {
      body: t.Object({
        message: t.String({ minLength: 1, maxLength: 10_000 }),
        amend: t.Optional(t.Boolean()),
        all: t.Optional(t.Boolean()),
      }),
    },
  )
  .post(
    "/push",
    async ({ params, body }) => {
      const dir = projectDir(params.project);
      const upstream = (await git(dir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")).code === 0;
      const args = upstream ? ["push"] : ["push", "-u", "origin", "HEAD"];
      if (body.force) args.splice(1, 0, "--force-with-lease");
      const output = await run(dir, args, NETWORK_TIMEOUT);
      logActivity("git_push", params.project);
      return { ok: true, output };
    },
    { body: t.Object({ force: t.Optional(t.Boolean()) }) },
  )
  .post(
    "/pull",
    async ({ params, body }) => {
      const dir = projectDir(params.project);
      const output = await run(dir, ["pull", "--no-edit", body.rebase ? "--rebase" : "--ff-only"], NETWORK_TIMEOUT);
      logActivity("git_pull", params.project);
      return { ok: true, output };
    },
    { body: t.Object({ rebase: t.Optional(t.Boolean()) }) },
  )
  .post("/fetch", async ({ params }) => {
    const dir = projectDir(params.project);
    return { ok: true, output: await run(dir, ["fetch", "--all", "--prune"], NETWORK_TIMEOUT) };
  })
  .post(
    "/checkout",
    async ({ params, body }) => {
      const dir = projectDir(params.project);
      const name = checkBranchName(body.branch);
      let args: string[];
      if (body.create) args = ["switch", "-c", name];
      else if (body.remote) {
        // origin/feature → local "feature" tracking it (or just switch if it already exists).
        const local = name.slice(name.indexOf("/") + 1);
        const exists = (await git(dir, "rev-parse", "--verify", "-q", `refs/heads/${local}`)).code === 0;
        args = exists ? ["switch", local] : ["switch", "--track", name];
      } else args = ["switch", name];
      return { ok: true, output: await run(dir, args) };
    },
    { body: t.Object({ branch: t.String(), create: t.Optional(t.Boolean()), remote: t.Optional(t.Boolean()) }) },
  )
  .post(
    "/branches/remove",
    async ({ params, body }) => {
      const dir = projectDir(params.project);
      return { ok: true, output: await run(dir, ["branch", body.force ? "-D" : "-d", checkBranchName(body.branch)]) };
    },
    { body: t.Object({ branch: t.String(), force: t.Optional(t.Boolean()) }) },
  )
  .post(
    "/stash",
    async ({ params, body }) => {
      const dir = projectDir(params.project);
      const args =
        body.action === "pop" ? ["stash", "pop"] : ["stash", "push", "-u", ...(body.message ? ["-m", body.message] : [])];
      return { ok: true, output: await run(dir, args) };
    },
    { body: t.Object({ action: t.Union([t.Literal("push"), t.Literal("pop")]), message: t.Optional(t.String()) }) },
  )
  /** Merge another branch (e.g. a worktree's) into the branch checked out here. */
  .post(
    "/merge",
    async ({ params, body }) => {
      const dir = projectDir(params.project);
      const args = ["merge", "--no-edit", ...(body.noFf ? ["--no-ff"] : []), checkBranchName(body.branch)];
      const output = await run(dir, args);
      logActivity("git_merge", `${params.project} ← ${body.branch}`);
      return { ok: true, output };
    },
    { body: t.Object({ branch: t.String(), noFf: t.Optional(t.Boolean()) }) },
  )
  .post("/merge/abort", async ({ params }) => {
    const dir = projectDir(params.project);
    return { ok: true, output: await run(dir, ["merge", "--abort"]) };
  });
