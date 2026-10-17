import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { HttpError } from "./exec";

export const HOME = process.env.HOME ?? "/root";
export const PROJECTS_DIR = resolve(process.env.PROJECTS_DIR ?? join(process.env.HOME ?? "/root", "projects"));
export const DATA_DIR = resolve(process.env.DATA_DIR ?? join(process.env.HOME ?? "/root", ".project-hub"));
/** Trash lives inside PROJECTS_DIR so moving a project there is an atomic rename on the same filesystem. */
export const TRASH_DIR = join(PROJECTS_DIR, ".hub-trash");

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export class PathError extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}

export function validateName(name: string): string {
  if (!NAME_RE.test(name) || name.endsWith(".")) {
    throw new PathError("Invalid name: use letters, digits, '.', '_' or '-' (max. 64 characters)");
  }
  return name;
}

function isInside(root: string, p: string) {
  return p === root || p.startsWith(root + sep);
}

/** Realpath of the deepest existing ancestor joined with the not-yet-existing remainder. */
function realpathLoose(p: string): string {
  try {
    return realpathSync(p);
  } catch (e: any) {
    if (e?.code !== "ENOENT") throw e;
    const parent = dirname(p);
    if (parent === p) return p;
    return join(realpathLoose(parent), p.slice(parent.length + 1));
  }
}

/**
 * Resolve a path relative to `root` (default PROJECTS_DIR) and guarantee it stays inside it,
 * also after following symlinks. Works for paths that do not exist yet.
 */
export function safePath(rel: string, root = PROJECTS_DIR): string {
  if (typeof rel !== "string" || rel.includes("\0")) throw new PathError("Invalid path");
  if (isAbsolute(rel)) throw new PathError("Path must be relative");
  const realRoot = realpathLoose(root);
  const target = resolve(realRoot, rel);
  if (!isInside(realRoot, target)) throw new PathError("Path is outside the projects folder");
  const real = realpathLoose(target);
  if (!isInside(realRoot, real)) throw new PathError("Path is outside the projects folder");
  return real;
}

/** Absolute directory of a project; the project name must be a single valid segment. */
export function projectDir(project: string): string {
  validateName(project);
  return safePath(project);
}

export async function isDir(p: string) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export function relToProjects(abs: string): string {
  return relative(realpathLoose(PROJECTS_DIR), abs);
}
