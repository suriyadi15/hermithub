import { useQuery } from "@tanstack/react-query";
import { Activity, Bot, Cpu, FolderGit2, HardDrive, MemoryStick, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { ProjectCard } from "@/components/ProjectCard";
import { SessionCard } from "@/components/SessionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api";
import { bytes } from "@/lib/format";
import { POLL_MS, useAgents, useProjects, useSessions } from "@/lib/queries";

function useNow(interval = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

function Stat({ icon: Icon, label, value, sub, pct }: { icon: typeof Cpu; label: string; value: string; sub?: string; pct?: number }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0 sm:size-4" /> <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 truncate text-xl font-semibold tabular-nums sm:mt-1 sm:text-2xl">{value}</div>
      {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
      {pct !== undefined && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted sm:mt-2 sm:h-1.5">
          <div
            className={pct > 0.9 ? "h-full bg-destructive" : pct > 0.75 ? "h-full bg-warning" : "h-full bg-primary"}
            style={{ width: `${Math.min(100, pct * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const now = useNow();
  const projects = useProjects();
  const sessions = useSessions();
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => unwrap(api.stats.get()), refetchInterval: POLL_MS * 2 });
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);

  const shown = useMemo(
    () => (projects.data ?? []).filter((p) => p.name.toLowerCase().includes(filter.toLowerCase())),
    [projects.data, filter],
  );
  const running = sessions.data?.filter((s) => s.status !== "exited").length ?? 0;
  const s = stats.data;
  const agents = useAgents();
  const noAgents = agents.data !== undefined && !agents.data.some((a) => a.installed);

  return (
    <div className="pb-safe mx-auto w-full max-w-7xl space-y-6 px-3 py-4 sm:space-y-8 sm:px-6 sm:py-6">
      {noAgents && (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 p-4">
          <Bot className="size-6 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Get started</h2>
            <p className="text-sm text-muted-foreground">
              Install an AI agent (Claude Code, Codex, Gemini CLI, OpenCode, Copilot…) and connect GitHub. Everything runs inside the container.
            </p>
          </div>
          <Button asChild>
            <Link to="/settings">Open Settings</Link>
          </Button>
        </section>
      )}
      <section className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <Stat icon={Activity} label="Running sessions" value={String(running)} sub={`${projects.data?.length ?? 0} projects`} />
        <Stat
          icon={Cpu}
          label="Load (1m)"
          value={s ? s.load[0]!.toFixed(2) : "–"}
          sub={s ? `${s.cpus} CPU · 5m ${s.load[1]!.toFixed(2)}` : undefined}
          pct={s ? s.load[0]! / s.cpus : undefined}
        />
        <Stat
          icon={MemoryStick}
          label="Memori"
          value={s ? bytes(s.mem.total - s.mem.available) : "–"}
          sub={s ? `of ${bytes(s.mem.total)}` : undefined}
          pct={s ? 1 - s.mem.available / s.mem.total : undefined}
        />
        <Stat
          icon={HardDrive}
          label="Disk"
          value={s ? bytes(s.disk.used) : "–"}
          sub={s ? `${bytes(s.disk.available)} free` : undefined}
          pct={s ? s.disk.used / s.disk.total : undefined}
        />
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">
            Active sessions{sessions.data?.length ? <span className="ml-1.5 text-muted-foreground">{sessions.data.length}</span> : null}
          </h2>
          <span className="hidden text-xs text-muted-foreground sm:inline">refreshes every {POLL_MS / 1000} s</span>
        </div>
        {sessions.isLoading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
          </div>
        ) : sessions.data?.length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sessions.data.map((x) => (
              <SessionCard key={x.name} session={x} now={now} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No sessions yet. Start one from a project below.
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-lg font-semibold">
            Project{projects.data?.length ? <span className="ml-1.5 text-muted-foreground">{projects.data.length}</span> : null}
          </h2>
          <div className="relative order-last w-full sm:order-none sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search projects…"
              className="h-10 pl-8 sm:h-9"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <Button className="h-10 sm:h-9" aria-label="New project" onClick={() => setCreating(true)}>
            <Plus /> <span className="hidden min-[400px]:inline">New project</span>
          </Button>
        </div>
        {projects.isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        ) : shown.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((p) => (
              <ProjectCard key={p.name} project={p} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            <FolderGit2 className="size-8" />
            {filter ? "No matching projects." : "No projects yet."}
            {!filter && (
              <Button variant="secondary" onClick={() => setCreating(true)}>
                <Plus /> Create your first project
              </Button>
            )}
          </div>
        )}
      </section>

      <NewProjectDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(name) => navigate(`/p/${encodeURIComponent(name)}`)}
      />
    </div>
  );
}
