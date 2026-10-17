import { Elysia, t } from "elysia";
import { exec, HttpError } from "./exec";
import { projectDir } from "./paths";

const MAX_FILES = 200;
const MAX_MATCHES = 2000;

/** ripgrep, honouring .gitignore but still showing dotfiles (except .git itself). */
function rg(cwd: string, args: string[]) {
  return exec(["rg", "--hidden", "-g", "!.git", "-g", "!node_modules", ...args], { cwd, timeoutMs: 15_000 });
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

export const searchRoutes = new Elysia({ prefix: "/api/search" })
  .get(
    "/files",
    async ({ query }) => {
      const dir = projectDir(query.project);
      const r = await rg(dir, ["--files"]);
      if (r.code > 1) throw new HttpError(500, r.stderr.trim() || "rg failed");
      const all = r.stdout.split("\n").filter(Boolean).map((p) => p.replace(/^\.\//, ""));
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
      const args = ["--json", "--max-count", "100", "--max-columns", "1000", "--max-filesize", "2M"];
      if (!query.regex) args.push("--fixed-strings");
      args.push(query.case ? "--case-sensitive" : "--ignore-case");
      if (query.word) args.push("--word-regexp");
      for (const g of (query.glob ?? "").split(",").map((s) => s.trim()).filter(Boolean)) args.push("-g", g);
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
