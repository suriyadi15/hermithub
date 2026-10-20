import { ArrowLeft, FolderOpen } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { ModeBadge, SessionActions, SessionTabMenu, StatusDot } from "@/components/SessionCard";
import { TerminalView } from "@/components/TerminalView";
import { Button } from "@/components/ui/button";
import { useModes } from "@/lib/modes";
import { useSessions } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Every session of every project as a tab; terminals stay mounted (hidden) so connections survive tab switches. */
export default function SessionsPage() {
  const sessions = useSessions();
  const { info: modeInfo } = useModes();
  const [search, setSearch] = useSearchParams();

  const list = useMemo(
    () =>
      [...(sessions.data ?? [])].sort(
        (a, b) => a.project.localeCompare(b.project) || a.created - b.created,
      ),
    [sessions.data],
  );
  const wanted = search.get("s");
  const activeSession = list.find((s) => s.name === wanted) ?? list[0];
  const active = activeSession?.name;

  useEffect(() => {
    if (active && active !== wanted) setSearch({ s: active }, { replace: true });
  }, [active, wanted, setSearch]);

  const tabClass = (on: boolean) =>
    cn(
      "flex shrink-0 items-center gap-2 border-r px-3 text-sm max-md:h-11 md:py-2",
      on ? "bg-background text-foreground" : "text-muted-foreground hover:bg-accent/50",
    );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5 pt-safe-1.5 md:gap-2 md:px-3 md:py-2 md:pt-safe-2">
        <Button asChild size="icon" variant="ghost" className="size-10 md:size-8">
          <Link to="/" title="Dashboard" aria-label="Back to dashboard">
            <ArrowLeft className="size-5 md:size-4" />
          </Link>
        </Button>
        <h1 className="min-w-0 flex-1 truncate font-semibold">All sessions</h1>
        {activeSession && (
          <>
            <ModeBadge mode={activeSession.mode} />
            <Button asChild size="sm" variant="ghost" className="max-md:hidden">
              <Link to={`/p/${encodeURIComponent(activeSession.project)}?s=${activeSession.name}`}>
                <FolderOpen /> Open project
              </Link>
            </Button>
            <SessionActions session={activeSession} />
          </>
        )}
      </div>
      {list.length > 0 && (
        <div className="flex shrink-0 items-stretch overflow-x-auto border-b bg-card/50 [scrollbar-width:none]">
          {list.map((s) => {
            const Icon = modeInfo(s.mode).icon;
            return (
              <SessionTabMenu key={s.name} session={s}>
                <button
                  onClick={() => setSearch({ s: s.name }, { replace: true })}
                  title={s.worktree ? `${s.project} @ ${s.worktree}` : s.project}
                  className={tabClass(s.name === active)}
                >
                  <StatusDot status={s.status} />
                  <Icon className="size-3.5" />
                  <span className="max-w-24 truncate rounded bg-muted px-1.5 text-xs text-muted-foreground">{s.project}</span>
                  <span className="max-w-36 truncate">{s.label}</span>
                </button>
              </SessionTabMenu>
            );
          })}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {list.map((s) => (
          <div key={s.name} className={cn("absolute inset-0", s.name !== active && "invisible")}>
            <TerminalView name={s.name} active={s.name === active} />
          </div>
        ))}
        {!sessions.isLoading && list.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
            <p>No running sessions in any project.</p>
            <Button asChild variant="outline">
              <Link to="/">Go to dashboard</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
