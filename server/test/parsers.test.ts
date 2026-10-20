import { describe, expect, test } from "bun:test";
import { parseBranches, parseStatus, parseTags } from "../src/git";
import { fuzzyScore, parseGitGrep, parseRgJson } from "../src/search";
import { repoName } from "../src/projects";
import { buildCommand, treeUsage } from "../src/sessions";
import { findLoginHints, findRemoteUrl, parseScrollFrame, parseSessions, tailLines, wheelSeq } from "../src/tmux";

describe("tmux", () => {
  test("parseSessions reads our format and skips foreign sessions", () => {
    const line = ["hermithub-abc", "1700000000", "1700000100", "1", "0", "", "42", "demo", "claude", "plan", "fitur x", "claude"].join(
      "||hub||",
    );
    const [s, ...rest] = parseSessions(`${line}\nother||hub||1\n`);
    expect(rest).toHaveLength(0);
    expect(s).toMatchObject({ name: "hermithub-abc", created: 1700000000000, attached: 1, dead: false, pid: 42, project: "demo", mode: "claude", permission: "plan", label: "fitur x" });
  });
  test("findRemoteUrl returns the last claude.ai/code link", () => {
    const text = "old https://claude.ai/code/session_1\nConnect: https://claude.ai/code/session_2?x=1 \n";
    expect(findRemoteUrl(text)).toBe("https://claude.ai/code/session_2?x=1");
    expect(findRemoteUrl("nothing here")).toBeNull();
  });
  test("tailLines drops trailing blank lines", () => {
    expect(tailLines("a\nb\nc\n\n\n", 2)).toBe("b\nc");
  });
});

describe("git", () => {
  test("parseStatus", () => {
    const r = parseStatus("## main...origin/main [ahead 2, behind 1]\n M src/a.ts\n?? new.txt\nR  old -> renamed\n");
    expect(r.branch).toBe("main");
    expect(r.ahead).toBe(2);
    expect(r.behind).toBe(1);
    expect(r.files.map((f) => f.path)).toEqual(["src/a.ts", "new.txt", "renamed"]);
  });
  test("parseStatus on a fresh repo", () => {
    expect(parseStatus("## No commits yet on main\n").branch).toBe("main");
  });
  test("parseStatus -z splits staged/unstaged and renames", () => {
    const r = parseStatus("## dev...origin/dev [behind 3]\0MM src/a.ts\0R  new name.ts\0old.ts\0?? x.txt\0UU c.ts\0A  added.ts\0");
    expect(r.branch).toBe("dev");
    expect(r.upstream).toBe("origin/dev");
    expect(r.behind).toBe(3);
    expect(r.files.map((f) => [f.path, f.staged, f.unstaged, f.untracked, f.conflict])).toEqual([
      ["src/a.ts", true, true, false, false],
      ["new name.ts", true, false, false, false],
      ["x.txt", false, true, true, false],
      ["c.ts", false, true, false, true],
      ["added.ts", true, false, false, false],
    ]);
    expect(r.files[1]!.orig).toBe("old.ts");
    expect(parseStatus("## HEAD (no branch)\0").detached).toBe(true);
    expect(parseStatus("## main\0").upstream).toBeNull();
  });
  test("parseBranches", () => {
    const row = (...f: string[]) => f.join("\x1f");
    const out = [
      row("refs/heads/main", "main", "*", "origin/main", "[ahead 1]", "1700000000", "init"),
      row("refs/remotes/origin/HEAD", "origin", " ", "", "", "1700000000", "init"),
      row("refs/remotes/origin/main", "origin/main", " ", "", "", "1700000000", "init"),
    ].join("\n");
    const b = parseBranches(out);
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({ name: "main", current: true, remote: false, upstream: "origin/main", ahead: 1, date: 1700000000000 });
    expect(b[1]).toMatchObject({ name: "origin/main", remote: true, current: false, upstream: null });
  });
  test("parseTags", () => {
    const out = ["v1.0\x1f1700000000\x1frelease", "light\x1f1700000001\x1f"].join("\n") + "\n";
    expect(parseTags(out)).toEqual([
      { name: "v1.0", date: 1700000000000, subject: "release" },
      { name: "light", date: 1700000001000, subject: "" },
    ]);
  });
  test("repoName", () => {
    expect(repoName("https://github.com/a/b.git")).toBe("b");
    expect(repoName("git@github.com:a/my-repo.git")).toBe("my-repo");
    expect(repoName("https://gitlab.com/g/sub/proj/")).toBe("proj");
  });
});

describe("sessions", () => {
  test("buildCommand", () => {
    expect(buildCommand("claude", {})).toEqual(["claude"]);
    expect(buildCommand("claude", { permission: "default" })).toEqual(["claude", "--permission-mode", "default"]);
    expect(buildCommand("claude", { permission: "plan", resume: true })).toEqual(["claude", "--continue", "--permission-mode", "plan"]);
    expect(buildCommand("rc", { permission: "acceptEdits", name: "demo" })).toEqual([
      "claude", "remote-control", "--name", "demo", "--spawn", "same-dir", "--permission-mode", "acceptEdits",
    ]);
    expect(buildCommand("rc", { spawn: "worktree" })).toEqual(["claude", "remote-control", "--spawn", "worktree"]);
    expect(buildCommand("rc", { resume: true })).toEqual(["claude", "remote-control", "--continue"]);
    expect(buildCommand("bash", {})).toEqual(["bash", "-l"]);
    expect(buildCommand("codex", { permission: "yolo" })).toEqual(["codex", "--dangerously-bypass-approvals-and-sandbox"]);
    expect(buildCommand("codex", { resume: true, permission: "read-only" })).toEqual(["codex", "resume", "--last", "--sandbox", "read-only"]);
    expect(buildCommand("codex", { permission: "default" })).toEqual(["codex"]);
    expect(buildCommand("gemini", { resume: true, permission: "auto_edit" })).toEqual([
      "gemini", "--resume", "latest", "--approval-mode", "auto_edit",
    ]);
    expect(buildCommand("opencode", { resume: true, permission: "plan" })).toEqual(["opencode", "--continue", "--agent", "plan"]);
    expect(buildCommand("opencode", { permission: "default" })).toEqual(["opencode"]);
    expect(buildCommand("copilot", { resume: true, permission: "yolo" })).toEqual(["copilot", "--continue", "--yolo"]);
    expect(buildCommand("qwen", { permission: "auto-edit" })).toEqual(["qwen", "--approval-mode", "auto-edit"]);
    expect(buildCommand("crush", { resume: true, permission: "yolo" })).toEqual(["crush", "--continue", "--yolo"]);
    expect(() => buildCommand("nope", {})).toThrow();
  });
  test("treeUsage sums a process subtree", () => {
    const procs = [
      { pid: 1, ppid: 0, cpu: 1, rssKb: 1024 },
      { pid: 10, ppid: 1, cpu: 2.5, rssKb: 2048 },
      { pid: 11, ppid: 10, cpu: 0.5, rssKb: 1024 },
      { pid: 20, ppid: 0, cpu: 9, rssKb: 9999 },
    ];
    expect(treeUsage(procs, 10)).toEqual({ cpu: 3, memMB: 3 });
  });
});

describe("terminal scrolling", () => {
  test("wheelSeq repeats SGR wheel reports", () => {
    expect(wheelSeq("up", 2)).toBe("\x1b[<64;1;1M\x1b[<64;1;1M");
    expect(wheelSeq("down", 1)).toBe("\x1b[<65;1;1M");
  });
  test("parseScrollFrame validates and clamps", () => {
    expect(parseScrollFrame('{"dir":"up","lines":3}')).toEqual({ dir: "up", lines: 3 });
    expect(parseScrollFrame('{"dir":"down","lines":9999}')).toEqual({ dir: "down", lines: 200 });
    expect(parseScrollFrame('{"dir":"exit"}')).toEqual({ dir: "exit", lines: 1 });
    expect(parseScrollFrame('{"dir":"up","lines":0}')).toEqual({ dir: "up", lines: 1 });
    expect(parseScrollFrame('{"dir":"sideways"}')).toBeNull();
    expect(parseScrollFrame("up")).toBeNull();
  });
});

describe("search", () => {
  test("fuzzyScore prefers file-name hits", () => {
    expect(fuzzyScore("src/components/GitPanel.tsx", "gitp")).toBeGreaterThan(fuzzyScore("src/git/types/panel.ts", "gitp"));
    expect(fuzzyScore("README.md", "xyz")).toBe(-1);
    expect(fuzzyScore("a/b.ts", "")).toBe(0);
  });
  test("parseRgJson groups matches and converts byte offsets", () => {
    const m = (path: string, line: number, text: string, start: number, end: number) =>
      JSON.stringify({ type: "match", data: { path: { text: path }, lines: { text: text + "\n" }, line_number: line, submatches: [{ start, end }] } });
    const out = [
      JSON.stringify({ type: "begin", data: { path: { text: "./a.ts" } } }),
      m("./a.ts", 3, "const é = foo;", 11, 14), // "é" is 2 bytes
      m("./a.ts", 9, "foo()", 0, 3),
      m("b.ts", 1, "foo", 0, 3),
    ].join("\n");
    const r = parseRgJson(out);
    expect(r.total).toBe(3);
    expect(r.files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(r.files[0]!.matches[0]).toEqual({ line: 3, text: "const é = foo;", ranges: [[10, 13]] });
    expect(parseRgJson(out, 2).truncated).toBe(true);
  });
});

describe("git grep fallback", () => {
  test("parseGitGrep groups matches and finds ranges", () => {
    const out = ["a.ts\x003\x00const é = Foo;", "a.ts\x009\x00foo()", "b.ts\x001\x00foo foo"].join("\n");
    const r = parseGitGrep(out, "foo");
    expect(r.total).toBe(3);
    expect(r.files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(r.files[0]!.matches[0]).toEqual({ line: 3, text: "const é = Foo;", ranges: [[10, 13]] });
    expect(r.files[1]!.matches[0]!.ranges).toEqual([[0, 3], [4, 7]]);
    expect(parseGitGrep(out, "foo", { case: true }).files[0]!.matches[0]!.ranges).toEqual([]);
    expect(parseGitGrep(out, "foo", {}, 2).truncated).toBe(true);
  });
});

describe("login hints", () => {
  test("finds the last URL and one-time code", () => {
    const text = "! First copy your one-time code: 8409-737E\nPress Enter to open github.com in your browser...\nhttps://github.com/login/device\n";
    expect(findLoginHints(text)).toEqual({ url: "https://github.com/login/device", code: "8409-737E" });
    expect(findLoginHints("nothing here")).toEqual({ url: null, code: null });
  });
});
