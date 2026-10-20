import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Code,
  ExternalLink,
  File,
  FolderGit2,
  FolderTree,
  GitBranch,
  History,
  Plus,
  RotateCcw,
  Save,
  Search,
  SquareTerminal,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { FileTree } from "@/components/FileTree";
import { GitPanel } from "@/components/GitPanel";
import { NewSessionDialog } from "@/components/NewSessionDialog";
import { PlainEditor, type Reveal } from "@/components/PlainEditor";
import { QuickOpen } from "@/components/QuickOpen";
import { SearchPanel } from "@/components/SearchPanel";
import { ModeBadge, SessionActions, SessionTabMenu, StatusDot } from "@/components/SessionCard";
import { TerminalView } from "@/components/TerminalView";
import { WorktreesPanel } from "@/components/WorktreesPanel";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useIsMobile, useIsTouch } from "@/hooks/use-mobile";
import { api, ApiError, unwrap, type SessionMode } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { ago } from "@/lib/format";
import { useModes } from "@/lib/modes";
import { useProjects, useSessions, useStartSession, useWorktrees } from "@/lib/queries";
import { cn } from "@/lib/utils";

const CodeEditor = lazy(() => import("@/components/CodeEditor"));

type OpenFile = {
  /** Workspace the file belongs to: the project or "project@worktree". */
  ws: string;
  path: string;
  content: string;
  saved: string;
  modified?: number;
  state: "loading" | "ready" | "binary" | "tooLarge" | "error";
  error?: string;
  reveal?: Reveal;
};

let revealSeq = 0;

/** Active pane key: `s:<session>`, `f:<ws>:<path>`, `f:` (editor, nothing open), `git`, or "" (no session yet). */
type Active = string;

const fileKey = (f: { ws: string; path: string }) => `f:${f.ws}:${f.path}`;
type MobileTab = "terminal" | "files" | "search" | "editor" | "git";
/** Panel shown over the work area on phones (and in the desktop sidebar): file tree or search. */
type Side = "files" | "search";

function readMonacoPref() {
  try {
    return localStorage.getItem("hermithub:monaco-on-touch") === "1";
  } catch {
    return false;
  }
}

export default function ProjectPage() {
  const project = decodeURIComponent(useParams().project ?? "");
  const [search, setSearch] = useSearchParams();
  const isMobile = useIsMobile();
  const isTouch = useIsTouch();
  const projects = useProjects();
  const sessions = useSessions(project);
  const start = useStartSession();
  const history = useQuery({
    queryKey: ["history", project],
    queryFn: () => unwrap(api.sessions.history.get({ query: { project } })),
    refetchInterval: 15_000,
  });

  const [active, setActive] = useState<Active>(() => (search.get("s") ? `s:${search.get("s")}` : ""));
  const [allFiles, setFiles] = useState<OpenFile[]>([]);
  const [newMode, setNewMode] = useState<SessionMode | null>(null);
  /** Worktree whose folder the file tree, search, editor and Git panel show; null = the project folder. */
  const [workspace, setWorkspace] = useState<string | null>(() => search.get("w"));
  const ws = workspace ? `${project}@${workspace}` : project;
  const worktrees = useWorktrees(project);
  const [worktreesOpen, setWorktreesOpen] = useState(false);
  /** Worktree preselected in the new-session dialog. */
  const [newWorktree, setNewWorktree] = useState<string | null>(null);
  // Tabs of files opened in other worktrees stay open but hidden until you switch back.
  const files = useMemo(() => allFiles.filter((f) => f.ws === ws), [allFiles, ws]);
  const { modes, info: modeInfo } = useModes();
  // Phones: file tree / search cover the work area. Desktop: which one the sidebar shows.
  const [sideOpen, setSideOpen] = useState<Side | null>(null);
  const [sidebar, setSidebar] = useState<Side>("files");
  const [quickOpen, setQuickOpen] = useState(false);
  const [findSeq, setFindSeq] = useState(0);
  const [lastSession, setLastSession] = useState<string | null>(null);
  const [monacoOnTouch, setMonacoOnTouch] = useState(readMonacoPref);

  const info = projects.data?.find((p) => p.name === project);
  const list = sessions.data ?? [];

  useEffect(() => {
    if (active.startsWith("s:")) setLastSession(active.slice(2));
  }, [active]);

  // Keep the active pane valid; default to the first session.
  useEffect(() => {
    if (!sessions.data) return;
    if (active.startsWith("f:")) {
      // Switching workspace hides the other worktree's files: show one of this workspace's instead.
      if (active !== "f:" && !files.some((f) => fileKey(f) === active)) setActive(files[0] ? fileKey(files[0]) : "f:");
      return;
    }
    const exists = (active.startsWith("s:") && list.some((s) => `s:${s.name}` === active)) || active === "git";
    if (!exists) setActive(list[0] ? `s:${list[0].name}` : files[0] ? fileKey(files[0]) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.data, files.length, ws]);

  // A worktree that was removed (here or elsewhere) falls back to the project folder.
  useEffect(() => {
    const d = worktrees.data;
    if (workspace && d && (!d.repo || !d.worktrees.some((w) => w.name === workspace))) setWorkspace(null);
  }, [worktrees.data, workspace]);

  useEffect(() => {
    const s = active.startsWith("s:") ? active.slice(2) : null;
    if ((search.get("s") ?? null) !== s || (search.get("w") ?? null) !== workspace) {
      setSearch({ ...(s ? { s } : {}), ...(workspace ? { w: workspace } : {}) }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, workspace]);

  const openFile = useCallback(
    async (path: string, line?: number, cols?: [number, number]) => {
      const fws = ws;
      const same = (f: OpenFile) => f.ws === fws && f.path === path;
      setSideOpen(null);
      setActive(fileKey({ ws: fws, path }));
      const reveal = line ? { line, cols, seq: ++revealSeq } : undefined;
      if (allFiles.some(same)) {
        if (reveal) setFiles((fs) => fs.map((f) => (same(f) ? { ...f, reveal } : f)));
        return;
      }
      setFiles((fs) => [...fs, { ws: fws, path, content: "", saved: "", state: "loading", reveal }]);
      try {
        const r = (await unwrap(api.files.read.get({ query: { project: fws, path } }))) as
          | { content: string; size: number; modified: number }
          | { binary: true; size: number }
          | { tooLarge: true; size: number };
        setFiles((fs) =>
          fs.map((f) =>
            !same(f)
              ? f
              : "content" in r
                ? { ...f, content: r.content, saved: r.content, modified: r.modified, state: "ready" }
                : { ...f, state: "binary" in r ? "binary" : "tooLarge" },
          ),
        );
      } catch (e) {
        setFiles((fs) => fs.map((f) => (same(f) ? { ...f, state: "error", error: (e as Error).message } : f)));
      }
    },
    [allFiles, ws],
  );

  /** Close several tabs at once with a single unsaved-changes prompt. `focus` is activated if the active tab closes. */
  const closeFiles = (paths: string[], focus?: string) => {
    if (!paths.length) return;
    const gone = new Set(paths);
    const dirty = files.filter((f) => gone.has(f.path) && f.content !== f.saved);
    if (dirty.length) {
      const msg = dirty.length === 1 ? `${dirty[0].path} has unsaved changes.` : `${dirty.length} files have unsaved changes.`;
      if (!confirm(`${msg} Close anyway?`)) return;
    }
    const rest = files.filter((f) => !gone.has(f.path));
    setFiles((fs) => fs.filter((x) => !(x.ws === ws && gone.has(x.path))));
    const activeIdx = files.findIndex((f) => fileKey(f) === active);
    if (activeIdx >= 0 && gone.has(files[activeIdx].path)) {
      const next = rest.find((f) => f.path === focus) ?? rest.find((f) => files.indexOf(f) > activeIdx) ?? rest[rest.length - 1];
      setActive(next ? fileKey(next) : "f:");
    }
  };
  const closeFile = (path: string) => closeFiles([path]);

  /** Saves always go to the workspace the file was opened from. */
  const saveFile = async (path: string, force = false, fws = ws) => {
    const same = (x: OpenFile) => x.ws === fws && x.path === path;
    const f = allFiles.find(same);
    if (!f || f.state !== "ready") return;
    try {
      const r = await unwrap(
        api.files.write.put({ project: fws, path, content: f.content, expectedModified: force ? undefined : f.modified }),
      );
      setFiles((fs) => fs.map((x) => (same(x) ? { ...x, saved: f.content, modified: r.modified } : x)));
      toast.success(`Saved: ${path}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.warning(e.message, {
          duration: 10_000,
          action: { label: "Timpa", onClick: () => saveFile(path, true, fws) },
        });
      } else toast.error((e as Error).message);
    }
  };

  const reloadFile = (path: string) => {
    setFiles((fs) => fs.filter((x) => !(x.ws === ws && x.path === path)));
    setTimeout(() => openFile(path));
  };

  const editFile = (f: OpenFile, content: string) =>
    setFiles((fs) => fs.map((x) => (x.ws === f.ws && x.path === f.path ? { ...x, content } : x)));

  const activeFile = active.startsWith("f:") ? files.find((f) => fileKey(f) === active) : undefined;
  const activeSession = active.startsWith("s:") ? list.find((s) => `s:${s.name}` === active) : undefined;
  const dirtyFiles = files.filter((f) => f.content !== f.saved).length;

  // The file tree, search and Git panel follow the session you switch to.
  useEffect(() => {
    if (activeSession) setWorkspace(activeSession.worktree ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.name]);

  const wsInfo = workspace
    ? worktrees.data?.worktrees.find((w) => w.name === workspace)
    : worktrees.data?.repo
      ? worktrees.data.main
      : undefined;
  const wsGit = workspace ? wsInfo?.git : info?.git;

  /** Open the new-session dialog, preselecting a worktree (null = the project folder). */
  const startSessionIn = (worktree: string | null, mode: SessionMode) => {
    setNewWorktree(worktree);
    setNewMode(mode);
  };

  // One entry per mode+label+worktree (newest first); --continue picks the latest conversation anyway.
  // Conversations of removed worktrees cannot be continued.
  const resumable = useMemo(() => {
    const seen = new Set<string>();
    const live = new Set(worktrees.data?.worktrees.map((w) => w.name));
    return (history.data ?? [])
      .filter((h) => h.mode !== "bash" && (!h.worktree || live.has(h.worktree)))
      .filter((h) => {
        const key = `${h.mode}:${h.label}:${h.worktree ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5);
  }, [history.data, worktrees.data]);

  // ---- mobile navigation ----
  const mobileTab: MobileTab = sideOpen
    ? sideOpen
    : active.startsWith("f:")
      ? "editor"
      : active === "git"
        ? "git"
        : "terminal";

  const goMobile = (tab: MobileTab) => {
    if (tab === "files" || tab === "search") return setSideOpen(tab);
    setSideOpen(null);
    if (tab === "git") return setActive("git");
    if (tab === "editor") {
      if (!active.startsWith("f:")) setActive(files[0] ? fileKey(files[0]) : "f:");
      return;
    }
    const s = list.find((x) => x.name === lastSession) ?? list[0];
    setActive(s ? `s:${s.name}` : "");
  };

  const useMonaco = !isTouch || monacoOnTouch;
  const toggleMonaco = () => {
    const next = !monacoOnTouch;
    setMonacoOnTouch(next);
    try {
      localStorage.setItem("hermithub:monaco-on-touch", next ? "1" : "0");
    } catch {}
  };

  // ---- pieces ----
  // Ctrl+P: find file by name; Ctrl+Shift+F: search in files.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "p" && !e.shiftKey) {
        e.preventDefault();
        setQuickOpen(true);
      } else if (k === "f" && e.shiftKey) {
        e.preventDefault();
        if (isMobile) setSideOpen("search");
        else setSidebar("search");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isMobile]);

  const sideSwitch = !isMobile && (
    <div className="mr-auto flex items-center gap-0.5">
      {(["files", "search"] as const).map((v) => (
        <button
          key={v}
          onClick={() => setSidebar(v)}
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide",
            sidebar === v ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {v === "files" ? <FolderTree className="size-3.5" /> : <Search className="size-3.5" />}
          {v === "files" ? "Files" : "Search"}
        </button>
      ))}
    </div>
  );

  const tree = (
    <FileTree
      project={ws}
      selected={activeFile?.path}
      onOpen={openFile}
      onQuickOpen={() => setQuickOpen(true)}
      title={sideSwitch || undefined}
    />
  );
  const searchPanel = <SearchPanel project={ws} onOpen={openFile} />;

  const tabClass = (on: boolean) =>
    cn(
      "flex shrink-0 items-center gap-2 border-r px-3 text-sm max-md:h-11 md:py-2",
      on ? "bg-background text-foreground" : "text-muted-foreground hover:bg-accent/50",
    );

  const sessionTabs = list.map((s) => {
    const Icon = modeInfo(s.mode).icon;
    return (
      <SessionTabMenu key={s.name} session={s}>
      <button onClick={() => setActive(`s:${s.name}`)} className={tabClass(active === `s:${s.name}`)}>
        <StatusDot status={s.status} />
        <Icon className="size-3.5" />
        <span className="max-w-36 truncate">{s.label}</span>
        {s.worktree && (
          <span title={`Worktree ${s.worktree}`} className="inline-flex items-center gap-0.5 text-xs text-info">
            <FolderGit2 className="size-3" />
            {s.worktree !== s.label && <span className="max-w-24 truncate">{s.worktree}</span>}
          </span>
        )}
      </button>
      </SessionTabMenu>
    );
  });

  const fileTabs = files.map((f, i) => {
    const dirty = f.content !== f.saved;
    const paths = files.map((x) => x.path);
    return (
      <ContextMenu key={fileKey(f)}>
        <ContextMenuTrigger asChild>
          <div
            className={cn(tabClass(active === fileKey(f)), "group gap-1 pr-1")}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              closeFile(f.path);
            }}
          >
            <button className="flex h-full items-center gap-1.5" onClick={() => setActive(fileKey(f))} title={f.path}>
              <File className="size-3.5" />
              <span className="max-w-36 truncate">{f.path.split("/").pop()}</span>
              {dirty && <span className="size-2 rounded-full bg-primary" />}
            </button>
            <button
              className="rounded p-1 opacity-60 hover:bg-accent hover:opacity-100"
              onClick={() => closeFile(f.path)}
              aria-label={`Close ${f.path}`}
            >
              <X className="size-3.5" />
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => closeFile(f.path)}>Close</ContextMenuItem>
          <ContextMenuItem disabled={files.length < 2} onClick={() => closeFiles(paths.filter((p) => p !== f.path), f.path)}>
            Close Others
          </ContextMenuItem>
          <ContextMenuItem disabled={i === files.length - 1} onClick={() => closeFiles(paths.slice(i + 1), f.path)}>
            Close to the Right
          </ContextMenuItem>
          <ContextMenuItem
            disabled={files.every((x) => x.content !== x.saved)}
            onClick={() => closeFiles(files.filter((x) => x.content === x.saved).map((x) => x.path), f.path)}
          >
            Close Saved
          </ContextMenuItem>
          <ContextMenuItem onClick={() => closeFiles(paths)}>Close All</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={async () => (await copyText(f.path)) ? toast.success("Path copied") : toast.error("Could not copy to the clipboard")}
          >
            Copy Path
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!dirty || f.state !== "ready"} onClick={() => saveFile(f.path, false, f.ws)}>
            Save
          </ContextMenuItem>
          <ContextMenuItem onClick={() => reloadFile(f.path)}>Reload</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  });

  const addSessionTab = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={tabClass(false)} aria-label="New session">
          <Plus className="size-4" />
          <span className="max-md:hidden">Session</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {modes.map((mi) => {
          const m = mi.mode;
          const Icon = mi.icon;
          return (
            <DropdownMenuItem key={m} className="max-md:py-2.5" onClick={() => startSessionIn(workspace, m)}>
              <Icon /> {mi.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const strip = (children: ReactNode) => (
    <div className="flex shrink-0 items-stretch overflow-x-auto border-b bg-card/50 [scrollbar-width:none]">{children}</div>
  );

  const sessionBar = activeSession && (
    <div className="flex shrink-0 items-center gap-x-3 gap-y-1 overflow-x-auto border-b px-3 py-1 text-xs whitespace-nowrap [scrollbar-width:none] md:flex-wrap md:py-1.5">
      <ModeBadge mode={activeSession.mode} />
      {activeSession.worktree && (
        <span className="inline-flex items-center gap-1 text-info">
          <FolderGit2 className="size-3" /> {activeSession.worktree}
        </span>
      )}
      {activeSession.mode !== "bash" && <span className="text-muted-foreground">{activeSession.permission}</span>}
      <span className="text-muted-foreground max-md:hidden">
        {activeSession.cpu}% CPU · {activeSession.memMB} MB
      </span>
      {activeSession.mode === "rc" &&
        (activeSession.remoteUrl ? (
          <a
            href={activeSession.remoteUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-info hover:underline"
          >
            <ExternalLink className="size-3" /> claude.ai/code
          </a>
        ) : (
          <span className="text-muted-foreground">waiting for link…</span>
        ))}
      {activeSession.status === "exited" && (
        <span className="text-warning">exited ({activeSession.exitStatus ?? "?"})</span>
      )}
      <div className="ml-auto">
        <SessionActions session={activeSession} />
      </div>
    </div>
  );

  const editorPane = activeFile && (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1 text-xs text-muted-foreground md:gap-2 md:px-3">
        <span className="min-w-0 flex-1 truncate font-mono" title={activeFile.path}>
          {activeFile.path}
        </span>
        {isTouch && (
          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={toggleMonaco} title="Switch editor">
            <Code className="size-3.5" /> {useMonaco ? "Teks" : "Monaco"}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 md:h-6"
          disabled={activeFile.state !== "ready"}
          onClick={() => setFindSeq((n) => n + 1)}
          title="Find in file (Ctrl+F)"
        >
          <Search className="size-3.5" /> <span className="max-md:hidden">Find</span>
        </Button>
        <Button size="sm" variant="ghost" className="h-8 px-2 md:h-6" onClick={() => reloadFile(activeFile.path)}>
          <RotateCcw className="size-3.5" /> <span className="max-md:hidden">Reload</span>
        </Button>
        <Button
          size="sm"
          className="h-8 px-3 md:h-6 md:px-2"
          disabled={activeFile.content === activeFile.saved}
          onClick={() => saveFile(activeFile.path)}
        >
          <Save className="size-3.5" /> Save
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {activeFile.state === "ready" ? (
          useMonaco ? (
            <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading editor…</div>}>
              <CodeEditor
                path={`${activeFile.ws}/${activeFile.path}`}
                value={activeFile.content}
                onChange={(v) => editFile(activeFile, v)}
                onSave={() => saveFile(activeFile.path)}
                reveal={activeFile.reveal}
                findSeq={findSeq}
              />
            </Suspense>
          ) : (
            <PlainEditor
              value={activeFile.content}
              onChange={(v) => editFile(activeFile, v)}
              onSave={() => saveFile(activeFile.path)}
              reveal={activeFile.reveal}
              findSeq={findSeq}
            />
          )
        ) : (
          <div className="p-6 text-sm text-muted-foreground">
            {activeFile.state === "loading" && "Loading…"}
            {activeFile.state === "binary" && "Binary files cannot be edited. Use Download in the file list."}
            {activeFile.state === "tooLarge" && "The file is over 2 MB, too large for the editor."}
            {activeFile.state === "error" && <span className="text-destructive">{activeFile.error}</span>}
          </div>
        )}
      </div>
    </div>
  );

  const emptySessions = (
    <div className="flex h-full flex-col items-center gap-5 overflow-y-auto p-4 text-center sm:justify-center sm:gap-6 sm:p-6">
      <div>
        <h2 className="text-lg font-semibold">No sessions yet</h2>
        <p className="text-sm text-muted-foreground">Start an agent or a terminal in {project}.</p>
      </div>
      <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-3">
        {modes.map((mi) => {
          const m = mi.mode;
          const Icon = mi.icon;
          return (
            <button
              key={m}
              onClick={() => startSessionIn(workspace, m)}
              className="flex items-center gap-3 rounded-xl border bg-card p-3 text-left text-sm transition-colors hover:border-primary/50 sm:flex-col sm:items-center sm:gap-1.5 sm:p-4 sm:text-center"
            >
              <Icon className="size-6 shrink-0 text-primary" />
              <span className="grid gap-0.5">
                <span className="font-medium">{mi.label}</span>
                <span className="text-xs text-muted-foreground">{mi.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      {resumable.length > 0 && (
        <div className="w-full max-w-xl text-left">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <History className="size-4" /> Continue a previous conversation
          </h3>
          <ul className="divide-y rounded-xl border bg-card">
            {resumable.map((h) => (
              <li key={h.name} className="flex items-center gap-2 px-3 py-2 text-sm">
                <ModeBadge mode={h.mode} />
                <span className="min-w-0 flex-1 truncate">
                  {h.label}
                  {h.worktree && <span className="text-xs text-info"> @ {h.worktree}</span>}
                </span>
                <span className="text-xs text-muted-foreground max-[380px]:hidden">{ago(h.ended_at)}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-9 sm:h-7"
                  disabled={start.isPending}
                  onClick={() =>
                    start.mutate(
                      {
                        project,
                        mode: h.mode,
                        permission: h.permission,
                        label: h.label,
                        resume: true,
                        worktree: h.worktree ?? undefined,
                      },
                      { onSuccess: (r) => setActive(`s:${r.name}`) },
                    )
                  }
                >
                  <RotateCcw /> Resume
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  const emptyEditor = (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
      <File className="size-8" />
      No file open.
      <Button variant="secondary" onClick={() => goMobile("files")}>
        <FolderTree /> Pick a file
      </Button>
    </div>
  );

  /** Everything below the tab strip: terminals stay mounted (hidden) so their connections survive tab switches. */
  const workArea = (
    <div className="relative min-h-0 flex-1">
      {list.map((s) => (
        <div key={s.name} className={cn("absolute inset-0", active !== `s:${s.name}` && "invisible")}>
          <TerminalView name={s.name} active={active === `s:${s.name}`} />
        </div>
      ))}
      {editorPane}
      {active === "f:" && emptyEditor}
      {active === "git" && (
        <div className="absolute inset-0">
          <GitPanel key={ws} project={ws} onOpenFile={openFile} />
        </div>
      )}
      {!active && emptySessions}
    </div>
  );

  const header = (
    <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5 pt-safe-1.5 md:gap-2 md:px-3 md:py-2 md:pt-safe-2">
      <Button asChild size="icon" variant="ghost" className="size-10 md:size-8">
        <Link to="/" title="Dashboard" aria-label="Back to dashboard">
          <ArrowLeft className="size-5 md:size-4" />
        </Link>
      </Button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-semibold leading-tight">{project}</h1>
        {worktrees.data?.repo ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex max-w-full items-center gap-1 truncate rounded text-xs text-muted-foreground hover:text-foreground max-md:min-h-6"
                title="Switch worktree"
              >
                {workspace ? <FolderGit2 className="size-3 shrink-0 text-info" /> : <GitBranch className="size-3 shrink-0" />}
                {workspace && <span className="truncate text-info">{workspace} ·</span>}
                <span className="truncate">{wsInfo?.branch ?? wsGit?.branch}</span>
                {!!wsGit?.dirty && <span className="shrink-0 text-warning"> · {wsGit.dirty} changed</span>}
                <ChevronDown className="size-3 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-w-80">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Show files, search and Git of</DropdownMenuLabel>
              {[worktrees.data.main, ...worktrees.data.worktrees].map(
                (w) =>
                  w && (
                    <DropdownMenuItem key={w.name ?? ""} className="max-md:py-2.5" onClick={() => setWorkspace(w.name ?? null)}>
                      {w.name ? <FolderGit2 /> : <GitBranch />}
                      <span className="min-w-0 flex-1 truncate">
                        {w.name ?? "Project folder"} <span className="text-muted-foreground">({w.branch ?? "detached"})</span>
                      </span>
                      {!!w.git?.dirty && <span className="text-xs text-warning">{w.git.dirty}</span>}
                      {(w.name ?? null) === workspace && <Check />}
                    </DropdownMenuItem>
                  ),
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="max-md:py-2.5" onClick={() => setWorktreesOpen(true)}>
                <Plus /> New / manage worktrees…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          info?.git && (
            <p className="truncate text-xs text-muted-foreground">
              <GitBranch className="mr-1 inline size-3" />
              {info.git.branch}
              {info.git.dirty > 0 && <span className="text-warning"> · {info.git.dirty} changed</span>}
            </p>
          )
        )}
      </div>
      {!isMobile && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm">
              <Plus /> Session
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {modes.map((mi) => {
              const m = mi.mode;
              const Icon = mi.icon;
              return (
                <DropdownMenuItem key={m} onClick={() => startSessionIn(workspace, m)}>
                  <Icon /> {mi.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );

  const dialog = (
    <>
    <QuickOpen open={quickOpen} onOpenChange={setQuickOpen} project={ws} onOpen={(p) => openFile(p)} />
    <NewSessionDialog
      open={newMode !== null}
      onOpenChange={(o) => !o && setNewMode(null)}
      project={project}
      initialMode={newMode ?? undefined}
      initialWorktree={newWorktree}
      onStarted={(name) => {
        setSideOpen(null);
        setActive(`s:${name}`);
      }}
    />
    <WorktreesPanel
      open={worktreesOpen}
      onOpenChange={setWorktreesOpen}
      project={project}
      current={workspace}
      onSelect={setWorkspace}
      onNewSession={(w) => {
        setWorktreesOpen(false);
        startSessionIn(w, modes[0]?.mode ?? "bash");
      }}
    />
    </>
  );

  if (!isMobile) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        <div className="min-h-0 flex-1">
          <ResizablePanelGroup orientation="horizontal" id="project-layout">
            <ResizablePanel defaultSize="22%" minSize={180} maxSize="45%">
              {/* Both stay mounted so the tree's expanded folders and the search results survive switching. */}
              <div className={cn("h-full", sidebar !== "files" && "hidden")}>{tree}</div>
              <div className={cn("flex h-full min-h-0 flex-col", sidebar !== "search" && "hidden")}>
                <div className="flex items-center border-b px-2 py-1.5">{sideSwitch}</div>
                <div className="min-h-0 flex-1">{searchPanel}</div>
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel minSize="40%">
              <div className="flex h-full min-h-0 flex-col">
                {strip(
                  <>
                    <button onClick={() => setActive("git")} className={tabClass(active === "git")}>
                      <GitBranch className="size-3.5" /> Git
                    </button>
                    {sessionTabs}
                    {fileTabs}
                  </>,
                )}
                {sessionBar}
                {workArea}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
        {dialog}
      </div>
    );
  }

  const navItems: { tab: MobileTab; label: string; icon: typeof File; badge?: number; dot?: boolean }[] = [
    { tab: "terminal", label: "Terminal", icon: SquareTerminal, badge: list.length || undefined },
    { tab: "files", label: "File", icon: FolderTree },
    { tab: "search", label: "Search", icon: Search },
    { tab: "editor", label: "Editor", icon: Code, badge: files.length || undefined, dot: dirtyFiles > 0 },
    { tab: "git", label: "Git", icon: GitBranch, badge: wsGit?.dirty || undefined },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      {mobileTab === "terminal" && (
        // One row on phones: scrollable session chips, then the active session's link + actions.
        <div className="flex shrink-0 items-stretch border-b bg-card/50">
          <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]">
            {sessionTabs}
            {addSessionTab}
          </div>
          {activeSession?.remoteUrl && (
            <a
              href={activeSession.remoteUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Open in claude.ai"
              className="flex w-10 shrink-0 items-center justify-center border-l text-info"
            >
              <ExternalLink className="size-4" />
            </a>
          )}
          {activeSession && (
            <div className="flex shrink-0 items-center border-l px-0.5">
              <SessionActions session={activeSession} />
            </div>
          )}
        </div>
      )}
      {mobileTab === "editor" && files.length > 0 && strip(fileTabs)}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {workArea}
        {sideOpen === "files" && <div className="absolute inset-0 z-10 bg-background">{tree}</div>}
        {/* Kept mounted so the query and results survive switching tabs. */}
        <div className={cn("absolute inset-0 z-10 bg-background", sideOpen !== "search" && "hidden")}>{searchPanel}</div>
      </div>
      <nav className="pb-safe grid shrink-0 grid-cols-5 border-t bg-card keyboard-open:hidden">
        {navItems.map((n) => (
          <button
            key={n.tab}
            aria-label={n.label}
            aria-current={mobileTab === n.tab ? "page" : undefined}
            onClick={() => goMobile(n.tab)}
            className={cn(
              "relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]",
              mobileTab === n.tab ? "text-primary" : "text-muted-foreground",
            )}
          >
            <span className="relative">
              <n.icon className="size-5" />
              {n.badge !== undefined && (
                <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-muted px-1 text-[10px] leading-4 text-foreground">
                  {n.badge}
                </span>
              )}
              {n.dot && <span className="absolute -left-1 -top-0.5 size-2 rounded-full bg-primary" />}
            </span>
            {n.label}
          </button>
        ))}
      </nav>
      {dialog}
    </div>
  );
}
