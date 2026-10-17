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
  return useMutation({
    mutationFn: (body: {
      project: string;
      mode: SessionMode;
      permission?: string;
      label?: string;
      resume?: boolean;
      spawn?: "same-dir" | "worktree";
    }) => unwrap(api.sessions.post(body)),
    onSuccess: invalidate,
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
