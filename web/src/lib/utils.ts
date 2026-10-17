import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Folder name for a worktree from its branch: feat/login → feat-login. */
export function worktreeName(branch: string) {
  return branch
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+|[.-]+$/g, "")
    .slice(0, 64);
}
