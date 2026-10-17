import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, fetchAgents, fetchProjects, fetchSessions, fetchTasks, unwrap, type SessionMode } from "./api";

export const POLL_MS = 3000;

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: fetchProjects, refetchInterval: 10_000 });
}

export function useSessions(project?: string) {
  return useQuery({
    queryKey: ["sessions", project ?? "*"],
    queryFn: () => fetchSessions(project),
    refetchInterval: POLL_MS,
  });
}

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => unwrap(api.settings.get()), staleTime: 60_000 });
}

export function useAgents() {
  return useQuery({ queryKey: ["agents"], queryFn: fetchAgents, staleTime: 30_000 });
}

/** System tasks (installs, logins). Polls fast while one is running. */
export function useTasks() {
  return useQuery({
    queryKey: ["tasks"],
    queryFn: fetchTasks,
    refetchInterval: (q) => (q.state.data?.some((t) => t.status === "running") ? 1500 : 10_000),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["sessions"] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };
}

function onError(e: Error) {
  toast.error(e.message);
}

export function useStartSession() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      project: string;
      mode: SessionMode;
      permission?: string;
      label?: string;
      resume?: boolean;
      spawn?: "same-dir" | "worktree";
      worktree?: string;
      newWorktree?: NewWorktree;
    }) => unwrap(api.sessions.post(body)),
    onSuccess: (_, body) => {
      invalidate();
      if (body.newWorktree) qc.invalidateQueries({ queryKey: ["worktrees", body.project] });
    },
    onError,
  });
}

export function useKillSession() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (name: string) => unwrap(api.sessions({ name }).delete()),
    onSuccess: () => {
      toast.success("Session stopped");
      invalidate();
    },
    onError,
  });
}

export function useRestartSession() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (name: string) => unwrap(api.sessions({ name }).restart.post()),
    onSuccess: () => {
      toast.success("Session restarted");
      invalidate();
    },
    onError,
  });
}

export function useRenameSession() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ name, label }: { name: string; label: string }) => unwrap(api.sessions({ name }).patch({ label })),
    onSuccess: invalidate,
    onError,
  });
}

export type NewWorktree = { name: string; branch?: string; base?: string };

/** Git worktrees of a project: one folder + branch per task. */
export function useWorktrees(project: string, enabled = true) {
  return useQuery({
    queryKey: ["worktrees", project],
    queryFn: () => unwrap(api.projects({ project }).worktrees.get()),
    refetchInterval: 5000,
    enabled,
  });
}

function useInvalidateWorktrees(project: string) {
  const qc = useQueryClient();
  return () => {
    for (const key of ["worktrees", "projects", "git", "git-branches"]) qc.invalidateQueries({ queryKey: [key] });
    qc.invalidateQueries({ queryKey: ["files", project] });
  };
}

export function useCreateWorktree(project: string) {
  const invalidate = useInvalidateWorktrees(project);
  return useMutation({
    mutationFn: (body: NewWorktree) => unwrap(api.projects({ project }).worktrees.post(body)),
    onSuccess: (r) => {
      toast.success(`Worktree ${r.name} created on branch ${r.branch}`);
      invalidate();
    },
    onError,
  });
}

export function useRemoveWorktree(project: string) {
  const invalidate = useInvalidateWorktrees(project);
  return useMutation({
    mutationFn: ({ name, force, deleteBranch }: { name: string; force?: boolean; deleteBranch?: boolean }) =>
      unwrap(
        api
          .projects({ project })
          .worktrees({ name })
          .delete(undefined, { query: { force, deleteBranch } }),
      ),
    onSuccess: (r, v) => {
      if (r.branchError) toast.warning(`Worktree removed, branch kept: ${r.branchError}`, { duration: 10_000 });
      else toast.success(`Worktree ${v.name} removed`);
      invalidate();
    },
    onError,
  });
}

/** Merge `branch` into the branch checked out in workspace `into` (a project or "project@worktree"). */
export function useMerge(project: string) {
  const invalidate = useInvalidateWorktrees(project);
  return useMutation({
    mutationFn: ({ into, branch }: { into: string; branch: string }) =>
      unwrap(api.projects({ project: into }).git.merge.post({ branch })),
    onSuccess: (r) => {
      toast.success(r.output.split("\n")[0] || "Merged");
      invalidate();
    },
    onError,
  });
}
