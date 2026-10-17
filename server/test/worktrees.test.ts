import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseWorktrees } from "../src/worktrees";

describe("parseWorktrees", () => {
  test("reads branches, detached heads and flags", () => {
    const out = [
      "worktree /p/app",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      "worktree /p/.hub-worktrees/app/login",
      "HEAD 2222222222222222222222222222222222222222",
      "branch refs/heads/feat/login",
      "locked",
      "",
      "worktree /p/.hub-worktrees/app/old",
      "HEAD 3333333333333333333333333333333333333333",
      "detached",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n");
    expect(parseWorktrees(out)).toEqual([
      { path: "/p/app", head: "1".repeat(40), branch: "main", bare: false, locked: false, prunable: false },
      { path: "/p/.hub-worktrees/app/login", head: "2".repeat(40), branch: "feat/login", bare: false, locked: true, prunable: false },
      { path: "/p/.hub-worktrees/app/old", head: "3".repeat(40), branch: null, bare: false, locked: false, prunable: true },
    ]);
  });
  test("empty output", () => {
    expect(parseWorktrees("")).toEqual([]);
  });
});

/**
 * Modules read PROJECTS_DIR once and test files share a module cache, so the end-to-end flow runs in
 * its own process with a temporary projects folder.
 */
describe("worktree flow", () => {
  const tmp = mkdtempSync(join(tmpdir(), "hub-wt-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  test("create, list, use, rename project, remove", async () => {
    const src = join(import.meta.dir, "../src");
    const script = join(tmp, "flow.ts");
    writeFileSync(
      script,
      `
import { $ } from "bun";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const { createWorktree, listWorktrees, removeWorktree } = await import(${JSON.stringify(src + "/worktrees")});
const { renameProject, trashProject } = await import(${JSON.stringify(src + "/projects")});
const { projectDir } = await import(${JSON.stringify(src + "/paths")});
const app = join(process.env.PROJECTS_DIR, "app");
mkdirSync(app);
await $\`git init -q -b main && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init\`.cwd(app);
const out = {};
out.created = await createWorktree("app", { name: "login", branch: "feat/login" });
await Bun.write(join(projectDir("app@login"), "new.txt"), "x");
out.list = await listWorktrees("app");
out.trash = await trashProject("app").then(() => "ok", (e) => e.status);
await renameProject("app", "app2");
out.afterRename = (await listWorktrees("app2")).worktrees.map((w) => [w.name, w.branch, w.git?.dirty]);
out.dirtyRemove = await removeWorktree("app2", "login", {}).then(() => "ok", (e) => e.status);
out.removed = await removeWorktree("app2", "login", { force: true, deleteBranch: true });
out.final = await listWorktrees("app2");
out.branches = (await $\`git branch --format='%(refname:short)'\`.cwd(projectDir("app2")).text()).trim();
console.log(JSON.stringify(out));
`,
    );
    await Bun.$`mkdir -p ${join(tmp, "projects")}`;
    const proc = Bun.spawn(["bun", script], {
      env: {
        ...process.env,
        PROJECTS_DIR: join(tmp, "projects"),
        DATA_DIR: join(tmp, "data"),
        HUB_DB: ":memory:",
        HUB_TMUX_SOCKET: `hub-test-${process.pid}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    const out = JSON.parse(stdout.trim().split("\n").pop()!);
    expect(out.created).toMatchObject({ name: "login", branch: "feat/login" });
    expect(out.list.main.branch).toBe("main");
    expect(out.list.worktrees).toHaveLength(1);
    expect(out.list.worktrees[0]).toMatchObject({ name: "login", branch: "feat/login", git: { dirty: 1 } });
    expect(out.trash).toBe(409);
    expect(out.afterRename).toEqual([["login", "feat/login", 1]]);
    expect(out.dirtyRemove).toBe(400);
    expect(out.removed.branchError).toBeNull();
    expect(out.final.worktrees).toEqual([]);
    expect(out.branches).toBe("main");
  });
});
