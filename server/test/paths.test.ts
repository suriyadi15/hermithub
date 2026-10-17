import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectDir, safePath, splitWorkspace, validateName } from "../src/paths";

let root: string;
let outside: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "hub-root-"));
  outside = mkdtempSync(join(tmpdir(), "hub-out-"));
  mkdirSync(join(root, "app/src"), { recursive: true });
  writeFileSync(join(outside, "secret"), "x");
  symlinkSync(outside, join(root, "app/escape"));
  symlinkSync(join(root, "app/src"), join(root, "app/inner-link"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("safePath", () => {
  test("resolves paths inside the root", () => {
    expect(safePath("app/src", root)).toBe(join(root, "app/src"));
    expect(safePath("app/src/new-file.ts", root)).toBe(join(root, "app/src/new-file.ts"));
    expect(safePath("", root)).toBe(root);
  });
  test("rejects traversal", () => {
    expect(() => safePath("../etc/passwd", root)).toThrow();
    expect(() => safePath("app/../../x", root)).toThrow();
  });
  test("rejects absolute paths and NUL bytes", () => {
    expect(() => safePath("/etc/passwd", root)).toThrow();
    expect(() => safePath("app\0x", root)).toThrow();
  });
  test("rejects symlinks that leave the root, also for new files under them", () => {
    expect(() => safePath("app/escape", root)).toThrow();
    expect(() => safePath("app/escape/secret", root)).toThrow();
    expect(() => safePath("app/escape/new.txt", root)).toThrow();
  });
  test("allows symlinks that stay inside", () => {
    expect(safePath("app/inner-link", root)).toBe(join(root, "app/src"));
  });
});

describe("validateName", () => {
  test.each(["my-app", "a", "repo.v2", "Proj_1"])("accepts %s", (n) => expect(validateName(n)).toBe(n));
  test.each(["", ".hidden", "..", "a/b", "a b", "x.", "-flag", "a".repeat(65)])("rejects %p", (n) =>
    expect(() => validateName(n)).toThrow(),
  );
});

describe("workspaces", () => {
  test("splits project and worktree ids", () => {
    expect(splitWorkspace("app")).toEqual({ project: "app", worktree: null });
    expect(splitWorkspace("app@login-fix")).toEqual({ project: "app", worktree: "login-fix" });
  });
  test.each(["app@", "@wt", "a@b@c", "app@../x", "app@.hidden", "../x@wt"])("rejects %p", (id) =>
    expect(() => splitWorkspace(id)).toThrow(),
  );
  test("worktrees resolve inside the hidden worktrees folder", () => {
    expect(projectDir("app@login").endsWith(join(".hub-worktrees", "app", "login"))).toBe(true);
  });
});
