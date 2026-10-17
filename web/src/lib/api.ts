import { treaty } from "@elysiajs/eden";
import type { App } from "../../../server/src/index";

export const client = treaty<App>(window.location.origin, {
  fetch: { credentials: "same-origin" },
});
export const api = client.api;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Unwrap an Eden response: return data or throw an ApiError with the server's message. */
export async function unwrap<T>(
  p: Promise<{ data: T; error: null } | { data: null; error: { status: unknown; value: unknown } }>,
): Promise<Exclude<T, null>> {
  const res = await p;
  if (res.error) {
    const value = res.error.value as { error?: string; message?: string } | string | undefined;
    const msg =
      typeof value === "string" ? value : (value?.error ?? value?.message ?? `HTTP ${String(res.error.status)}`);
    const status = Number(res.error.status) || 500;
    if (status === 401) window.dispatchEvent(new Event("hub:unauthorized"));
    throw new ApiError(status, msg);
  }
  return res.data as Exclude<T, null>;
}

export type Projects = Awaited<ReturnType<typeof fetchProjects>>;
export type Project = Projects[number];
export type Sessions = Awaited<ReturnType<typeof fetchSessions>>;
export type Session = Sessions[number];
export type SessionMode = Session["mode"];
export type Agent = Awaited<ReturnType<typeof fetchAgents>>[number];
export type Task = Awaited<ReturnType<typeof fetchTasks>>[number];

export const fetchProjects = () => unwrap(api.projects.get());
export const fetchSessions = (project?: string) => unwrap(api.sessions.get({ query: { project } }));
export const fetchAgents = () => unwrap(api.agents.get());
export const fetchTasks = () => unwrap(api.tasks.get());

export function wsUrl(path: string) {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}
