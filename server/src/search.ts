import { Elysia, t } from "elysia";
import { exec, HttpError } from "./exec";
import { projectDir } from "./paths";

const MAX_FILES = 200;
const MAX_MATCHES = 2000;

/** ripgrep, honouring .gitignore but still showing dotfiles (except .git itself). */
function rg(cwd: string, args: string[]) {
  return exec(["rg", "--hidden", "-g", "!.git", "-g", "!node_modules", ...args], { cwd, timeoutMs: 15_000 });
}

const hasRg = () => Bun.which("rg") !== null;
const SKIP_DIRS = /(^|\/)(node_modules|\.git)\//;

/** Project files, via ripgrep when installed, else `git ls-files`, else a plain directory walk. */
async function listFiles(dir: string): Promise<string[]> {
  if (hasRg()) {
    const r = await rg(dir, ["--files"]);
    if (r.code > 1) throw new HttpError(500, r.stderr.trim() || "rg failed");
    return r.stdout.split("\n").filter(Boolean).map((p) => p.replace(/^\.\//, ""));
  }
  const g = await exec(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: dir, timeoutMs: 15_000 });
  if (g.code === 0) return g.stdout.split("\0").filter((p) => p && !SKIP_DIRS.test(p));
  const out: string[] = [];
  for await (const p of new Bun.Glob("**/*").scan({ cwd: dir, dot: true, onlyFiles: true })) {
    if (SKIP_DIRS.test(p)) continue;
    out.push(p);
    if (out.length >= 50_000) break;
  }
  return out;
}

/**
 * Fuzzy score of `path` for `query` (subsequence match, case-insensitive), or -1 when it does not match.
 * Rewards consecutive characters, matches at word starts and in the file name.
 */
export function fuzzyScore(path: string, query: string): number {
  const p = path.toLowerCase();
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const nameStart = p.lastIndexOf("/") + 1;
  let score = 0;
  let pi = 0;
  let prev = -2;
  for (const ch of q) {
    const i = p.indexOf(ch, pi);
    if (i < 0) return -1;
    score += 1;
    if (i === prev + 1) score += 4;
    if (i === 0 || "/_-. ".includes(p[i - 1]!)) score += 3;
    if (i >= nameStart) score += 2;
    prev = i;
    pi = i + 1;
  }
  // A whole-substring hit in the file name beats a scattered one; shorter paths win ties.
  if (p.slice(nameStart).includes(q)) score += 10;
  return score - path.length * 0.01;
}

export interface TextMatch {
  line: number;
  text: string;
  /** [start, end) offsets in `text` (UTF-16). */
  ranges: [number, number][];
}

/** Turn `rg --json` output into matches grouped per file. Byte offsets are converted to string offsets. */
export function parseRgJson(out: string, limit = MAX_MATCHES) {
  const files: { path: string; matches: TextMatch[] }[] = [];
  let total = 0;
  let truncated = false;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  for (const line of out.split("\n")) {
    if (!line.startsWith('{"type":"match"')) continue;
    if (total >= limit) {
      truncated = true;
      break;
    }
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    const d = msg.data;
    const path = (d.path?.text as string | undefined)?.replace(/^\.\//, "");
    const raw: string | undefined = d.lines?.text;
    if (!path || raw === undefined) continue;
    const bytes = enc.encode(raw);
    const toChar = (b: number) => dec.decode(bytes.subarray(0, b)).length;
    const text = raw.replace(/\r?\n$/, "");
    const ranges: [number, number][] = (d.submatches ?? []).map((s: { start: number; end: number }) => [
      toChar(s.start),
      Math.min(toChar(s.end), text.length),
    ]);
    let f = files[files.length - 1];
    if (f?.path !== path) files.push((f = { path, matches: [] }));
    f.matches.push({ line: d.line_number, text: text.length > 400 ? text.slice(0, 400) : text, ranges });
    total++;
  }
  return { files, total, truncated };
}

export interface GrepOpts {
  regex?: boolean;
  case?: boolean;
  word?: boolean;
}

/** Turn `git grep -n --null` output (`path\0line\0text`) into the same shape as `parseRgJson`; match ranges are found in JS. */
export function parseGitGrep(out: string, query: string, opts: GrepOpts = {}, limit = MAX_MATCHES) {
  const files: { path: string; matches: TextMatch[] }[] = [];
  let total = 0;
  let truncated = false;
  let re: RegExp | null = null;
  try {
    const src = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(opts.word ? `\\b(?:${src})\\b` : src, opts.case ? "g" : "gi");
  } catch {}
  for (const line of out.split("\n")) {
    const z = line.indexOf("\0");
    if (z < 0) continue;
    const m = /^(\d+)\0(.*)$/.exec(line.slice(z + 1));
    if (!m) continue;
    if (total >= limit) {
      truncated = true;
      break;
    }
    const path = line.slice(0, z).replace(/^\.\//, "");
    const text = m[2]!.replace(/\r$/, "");
    const ranges: [number, number][] = [];
    if (re) {
      re.lastIndex = 0;
      for (let x = re.exec(text); x; x = re.exec(text)) {
        if (x[0] === "") re.lastIndex++;
        else ranges.push([x.index, x.index + x[0].length]);
      }
    }
    let f = files[files.length - 1];
    if (f?.path !== path) files.push((f = { path, matches: [] }));
    f.matches.push({ line: Number(m[1]), text: text.length > 400 ? text.slice(0, 400) : text, ranges });
    total++;
  }
  return { files, total, truncated };
}

/** `git grep` equivalent of the rg text search, for hosts without ripgrep. Works outside repos too (`--no-index`). */
function gitGrep(cwd: string, query: string, opts: GrepOpts, globs: string[]) {
  const args = ["grep", "--no-index", "--exclude-standard", "-n", "-I", "--null", opts.regex ? "-E" : "-F", opts.case ? "" : "-i"];
  if (opts.word) args.push("-w");
  args.push("-e", query, "--", ".", ":(exclude)node_modules", ":(exclude).git");
  for (const g of globs) args.push(g.startsWith("!") ? `:(exclude,glob)**/${g.slice(1)}` : `:(glob)**/${g}`);
  return exec(["git", ...args.filter(Boolean)], { cwd, timeoutMs: 15_000 });
}

export const searchRoutes = new Elysia({ prefix: "/api/search" })
  .get(
    "/files",
    async ({ query }) => {
      const dir = projectDir(query.project);
      const all = await listFiles(dir);
      if (!query.q.trim()) return all.sort((a, b) => a.length - b.length).slice(0, MAX_FILES);
      return all
        .map((p) => ({ p, s: fuzzyScore(p, query.q) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, MAX_FILES)
        .map((x) => x.p);
    },
    { query: t.Object({ project: t.String(), q: t.String({ default: "", maxLength: 200 }) }) },
  )
  .get(
    "/text",
    async ({ query }) => {
      const dir = projectDir(query.project);
      const globs = (query.glob ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!hasRg()) {
        const opts = { regex: query.regex, case: query.case, word: query.word };
        const g = await gitGrep(dir, query.q, opts, globs);
        // git grep: 0 = matches, 1 = none, 128/other = error.
        if (g.code > 1 && !g.stdout) throw new HttpError(400, g.stderr.trim().split("\n").slice(-3).join("\n") || "Search failed");
        return parseGitGrep(g.stdout, query.q, opts);
      }
      const args = ["--json", "--max-count", "100", "--max-columns", "1000", "--max-filesize", "2M"];
      if (!query.regex) args.push("--fixed-strings");
      args.push(query.case ? "--case-sensitive" : "--ignore-case");
      if (query.word) args.push("--word-regexp");
      for (const g of globs) args.push("-g", g);
      args.push("--", query.q, ".");
      const r = await rg(dir, args);
      // rg: 0 = matches, 1 = none, 2 = error (e.g. bad regex).
      if (r.code > 1 && !r.stdout) throw new HttpError(400, r.stderr.trim().split("\n").slice(-3).join("\n") || "Search failed");
      return parseRgJson(r.stdout);
    },
    {
      query: t.Object({
        project: t.String(),
        q: t.String({ minLength: 1, maxLength: 500 }),
        regex: t.Optional(t.BooleanString()),
        case: t.Optional(t.BooleanString()),
        word: t.Optional(t.BooleanString()),
        glob: t.Optional(t.String({ maxLength: 500 })),
      }),
    },
  );
