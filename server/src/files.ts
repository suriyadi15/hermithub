import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Elysia, t } from "elysia";
import { HttpError } from "./exec";
import { isDir, projectDir, safePath } from "./paths";

const MAX_EDIT_BYTES = 2 * 1024 * 1024;
const HIDDEN = new Set([".git"]);

/** Absolute path of `rel` inside a project; `rel` = "" is the project root. */
export function resolveInProject(project: string, rel: string) {
  const root = projectDir(project);
  return { root, abs: safePath(rel.replace(/^\/+/, ""), root) };
}

function notRoot(root: string, abs: string) {
  if (abs === root) throw new HttpError(400, "Not allowed on the project root");
}

async function exists(p: string) {
  return stat(p).then(
    () => true,
    () => false,
  );
}

export function looksBinary(buf: Uint8Array) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

const projectPath = { project: t.String(), path: t.String({ default: "" }) };

export const fileRoutes = new Elysia({ prefix: "/api/files" })
  .get(
    "/list",
    async ({ query }) => {
      const { abs } = resolveInProject(query.project, query.path);
      if (!(await isDir(abs))) throw new HttpError(404, "Folder not found");
      const entries = await readdir(abs, { withFileTypes: true });
      const items = await Promise.all(
        entries
          .filter((e) => !HIDDEN.has(e.name))
          .map(async (e) => {
            const st = await stat(join(abs, e.name)).catch(() => null);
            return {
              name: e.name,
              type: st?.isDirectory() ? ("dir" as const) : ("file" as const),
              size: st?.size ?? 0,
              modified: st?.mtimeMs ?? 0,
              symlink: e.isSymbolicLink(),
            };
          }),
      );
      return items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    },
    { query: t.Object(projectPath) },
  )
  .get(
    "/read",
    async ({ query }) => {
      const { abs } = resolveInProject(query.project, query.path);
      const st = await stat(abs).catch(() => null);
      if (!st?.isFile()) throw new HttpError(404, "File not found");
      if (st.size > MAX_EDIT_BYTES) return { tooLarge: true as const, size: st.size };
      const buf = new Uint8Array(await Bun.file(abs).arrayBuffer());
      if (looksBinary(buf)) return { binary: true as const, size: st.size };
      return { content: new TextDecoder().decode(buf), size: st.size, modified: st.mtimeMs };
    },
    { query: t.Object(projectPath) },
  )
  .get(
    "/download",
    async ({ query, set }) => {
      const { abs } = resolveInProject(query.project, query.path);
      const st = await stat(abs).catch(() => null);
      if (!st?.isFile()) throw new HttpError(404, "File not found");
      // Never let the browser render a project file (e.g. .html/.svg) on the dashboard's origin.
      const file = Bun.file(abs, { type: "application/octet-stream" });
      set.headers["content-disposition"] = `attachment; filename="${encodeURIComponent(basename(abs))}"`;
      return file;
    },
    { query: t.Object(projectPath) },
  )
  .put(
    "/write",
    async ({ body }) => {
      const { root, abs } = resolveInProject(body.project, body.path);
      notRoot(root, abs);
      // Optimistic concurrency: refuse to overwrite a file changed on disk (e.g. by Claude) since it was opened.
      if (body.expectedModified) {
        const st = await stat(abs).catch(() => null);
        if (st && Math.abs(st.mtimeMs - body.expectedModified) > 1) {
          throw new HttpError(409, "The file changed on disk since it was opened. Reload it first.");
        }
      }
      await writeFile(abs, body.content);
      const st = await stat(abs);
      return { modified: st.mtimeMs, size: st.size };
    },
    {
      body: t.Object({
        ...projectPath,
        content: t.String({ maxLength: MAX_EDIT_BYTES }),
        expectedModified: t.Optional(t.Number()),
      }),
    },
  )
  .post(
    "/create",
    async ({ body }) => {
      const { root, abs } = resolveInProject(body.project, body.path);
      notRoot(root, abs);
      if (await exists(abs)) throw new HttpError(409, "Already exists");
      if (body.type === "dir") await mkdir(abs, { recursive: true });
      else await writeFile(abs, "", { flag: "wx" });
      return { ok: true };
    },
    { body: t.Object({ ...projectPath, type: t.Union([t.Literal("file"), t.Literal("dir")]) }) },
  )
  .post(
    "/rename",
    async ({ body }) => {
      const { root, abs: from } = resolveInProject(body.project, body.from);
      const { abs: to } = resolveInProject(body.project, body.to);
      notRoot(root, from);
      notRoot(root, to);
      if (await exists(to)) throw new HttpError(409, "Destination already exists");
      await rename(from, to);
      return { ok: true };
    },
    { body: t.Object({ project: t.String(), from: t.String(), to: t.String() }) },
  )
  .delete(
    "/",
    async ({ query }) => {
      const { root, abs } = resolveInProject(query.project, query.path);
      notRoot(root, abs);
      await rm(abs, { recursive: true, force: true });
      return { ok: true };
    },
    { query: t.Object(projectPath) },
  )
  .post(
    "/upload",
    async ({ body }) => {
      const { abs: dir } = resolveInProject(body.project, body.path);
      if (!(await isDir(dir))) throw new HttpError(404, "Destination folder not found");
      const files = Array.isArray(body.files) ? body.files : [body.files];
      for (const f of files) {
        const target = safePath(basename(f.name), dir);
        await Bun.write(target, f);
      }
      return { uploaded: files.length };
    },
    {
      body: t.Object({
        ...projectPath,
        files: t.Union([t.File({ maxSize: "100m" }), t.Files({ maxSize: "100m" })]),
      }),
    },
  );
