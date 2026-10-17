import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  CloudDownload,
  FileDiff,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  Globe,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { api, unwrap } from "@/lib/api";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./dialogs";

type GitState = Extract<Awaited<ReturnType<typeof fetchGit>>, { repo: true }>;
type StatusFile = GitState["files"][number];
type OpResult = { ok: boolean; output?: string };

const fetchGit = (project: string) => unwrap(api.projects({ project }).git.get());

/** What the diff viewer shows: one file (staged or working tree), a whole group, or a commit. */
type DiffTarget =
  | { kind: "file"; path: string; staged: boolean; untracked: boolean }
  | { kind: "all"; staged: boolean }
  | { kind: "commit"; hash: string };

const diffKey = (d: DiffTarget | null) =>
  !d ? "" : d.kind === "file" ? `f:${d.staged}:${d.path}` : d.kind === "all" ? `a:${d.staged}` : `c:${d.hash}`;

const LETTER: Record<string, { label: string; cls: string; title: string }> = {
  M: { label: "M", cls: "text-warning", title: "modified" },
  A: { label: "A", cls: "text-success", title: "added" },
  D: { label: "D", cls: "text-destructive", title: "deleted" },
  R: { label: "R", cls: "text-info", title: "rename" },
  C: { label: "C", cls: "text-info", title: "copy" },
  T: { label: "T", cls: "text-warning", title: "type changed" },
  "?": { label: "U", cls: "text-success", title: "untracked" },
};

function letterOf(f: StatusFile, staged: boolean) {
  if (f.conflict) return { label: "!", cls: "text-destructive", title: "conflict" };
  return LETTER[staged ? f.index : f.worktree] ?? { label: (staged ? f.index : f.worktree).trim(), cls: "", title: f.status };
}

function DiffView({ diff }: { diff: string }) {
  if (!diff.trim()) return <p className="p-3 text-sm text-muted-foreground">No diff (binary or empty file).</p>;
  return (
    <pre className="max-h-[70vh] overflow-auto bg-terminal p-3 font-mono text-xs leading-relaxed">
      {diff.split("\n").map((l, i) => (
        <div
          key={i}
          className={cn(
            l.startsWith("+") && !l.startsWith("+++") && "bg-success/10 text-success",
            l.startsWith("-") && !l.startsWith("---") && "bg-destructive/10 text-destructive",
            l.startsWith("@@") && "text-info",
            (l.startsWith("diff ") || l.startsWith("index ") || l.startsWith("commit ")) && "text-muted-foreground",
          )}
        >
          {l || " "}
        </div>
      ))}
    </pre>
  );
}

function BranchDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: string;
  current: string;
  busy: boolean;
  onCheckout: (branch: string, opts: { create?: boolean; remote?: boolean }) => void;
  onDelete: (branch: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const branches = useQuery({
    queryKey: ["git-branches", props.project],
    queryFn: () => unwrap(api.projects({ project: props.project }).git.branches.get()),
    enabled: props.open,
  });
  const all = branches.data ?? [];
  const localNames = new Set(all.filter((b) => !b.remote).map((b) => b.name));
  const f = filter.trim().toLowerCase();
  const match = (n: string) => !f || n.toLowerCase().includes(f);
  const local = all.filter((b) => !b.remote && match(b.name));
  // Remote branches that already have a local counterpart add nothing to switch to.
  const remote = all.filter((b) => b.remote && !localNames.has(b.name.slice(b.name.indexOf("/") + 1)) && match(b.name));
  const newName = filter.trim().replace(/\s+/g, "-");
  const canCreate = newName && !all.some((b) => b.name === newName);

  const row = "flex items-center gap-2 px-3 py-2 text-sm max-md:py-2.5";
  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => {
        props.onOpenChange(o);
        if (!o) setFilter("");
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Branch</DialogTitle>
          <DialogDescription>Pick a branch to switch to, or type a name to create a new branch.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (local.length === 1 && local[0]!.name.toLowerCase() === f) props.onCheckout(local[0]!.name, {});
            else if (canCreate) props.onCheckout(newName, { create: true });
          }}
        >
          <Input autoFocus placeholder="Search / new branch name…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </form>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
          {canCreate && (
            <button
              className={cn(row, "w-full border-b text-left hover:bg-accent/60")}
              disabled={props.busy}
              onClick={() => props.onCheckout(newName, { create: true })}
            >
              <GitBranchPlus className="size-4 text-primary" />
              Create branch <span className="font-mono">{newName}</span> from {props.current}
            </button>
          )}
          {branches.isLoading && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
          {local.map((b) => (
            <div key={b.name} className={cn(row, "group border-b last:border-0 hover:bg-accent/60")}>
              <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                disabled={props.busy || b.current}
                onClick={() => props.onCheckout(b.name, {})}
              >
                {b.current ? <Check className="size-4 shrink-0 text-primary" /> : <GitBranch className="size-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0">
                  <span className="block truncate font-mono">{b.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {b.upstream && `${b.upstream} `}
                    {b.ahead > 0 && `↑${b.ahead} `}
                    {b.behind > 0 && `↓${b.behind} `}· {ago(b.date)} · {b.subject}
                  </span>
                </span>
              </button>
              {!b.current && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0 opacity-60 hover:opacity-100"
                  title={`Delete ${b.name}`}
                  onClick={() => props.onDelete(b.name)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
          {remote.length > 0 && (
            <div className="border-b bg-muted/40 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Remote</div>
          )}
          {remote.map((b) => (
            <button
              key={b.name}
              className={cn(row, "w-full border-b text-left last:border-0 hover:bg-accent/60")}
              disabled={props.busy}
              onClick={() => props.onCheckout(b.name, { remote: true })}
            >
              <Globe className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block truncate font-mono">{b.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {ago(b.date)} · {b.subject}
                </span>
              </span>
            </button>
          ))}
          {!branches.isLoading && local.length === 0 && remote.length === 0 && !canCreate && (
            <p className="p-3 text-sm text-muted-foreground">No matching branches.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Confirm = { title: string; description: string; label: string; action: () => void };

export function GitPanel({ project, onOpenFile }: { project: string; onOpenFile: (path: string) => void }) {
  const qc = useQueryClient();
  const g_ = () => api.projects({ project }).git;
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const git = useQuery({ queryKey: ["git", project], queryFn: () => fetchGit(project), refetchInterval: 5000 });
  const diff = useQuery({
    queryKey: ["git-diff", project, diffKey(diffTarget)],
    queryFn: () => {
      const d = diffTarget!;
      if (d.kind === "commit") return unwrap(g_().show.get({ query: { hash: d.hash } }));
      const query =
        d.kind === "file"
          ? { path: d.path, staged: d.staged ? "true" : undefined, untracked: d.untracked ? "true" : undefined }
          : { staged: d.staged ? "true" : undefined };
      return unwrap(g_().diff.get({ query: query as any }));
    },
    enabled: diffTarget !== null,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["git", project] });
    qc.invalidateQueries({ queryKey: ["git-diff", project] });
    qc.invalidateQueries({ queryKey: ["git-branches", project] });
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["files", project] });
  };

  const op = useMutation({ mutationFn: (fn: () => Promise<OpResult>) => fn() });
  /** Run a git operation; `done` = success toast text (omit for quiet ops like staging). */
  const run = (name: string, fn: () => Promise<OpResult>, done?: string, after?: () => void) => {
    setBusy(name);
    op.mutate(fn, {
      onSuccess: (r) => {
        if (done) toast.success(done, { description: r.output ? r.output.slice(-400) : undefined });
        after?.();
      },
      onError: (e) => toast.error(`${name} failed`, { description: e.message.slice(-600), duration: 10_000 }),
      onSettled: () => {
        setBusy(null);
        invalidate();
      },
    });
  };

  const files = git.data?.repo ? git.data.files : [];
  const staged = useMemo(() => files.filter((f) => f.staged), [files]);
  const changes = useMemo(() => files.filter((f) => f.unstaged), [files]);

  if (git.isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if (git.error) return <div className="p-4 text-sm text-destructive">{git.error.message}</div>;
  const g = git.data;
  if (!g || !g.repo) return <div className="p-4 text-sm text-muted-foreground">This project is not a git repository.</div>;

  const stage = (paths: string[] | "all") => run("Stage", () => unwrap(g_().stage.post({ paths })));
  const unstage = (paths: string[] | "all") => run("Unstage", () => unwrap(g_().unstage.post({ paths })));
  const discard = (paths: string[] | "all", what: string) =>
    setConfirm({
      title: `Discard changes in ${what}?`,
      description: "Unstaged changes are lost for good; untracked files are deleted.",
      label: "Discard",
      action: () => run("Discard", () => unwrap(g_().discard.post({ paths })), "Changes discarded"),
    });

  const commitAll = staged.length === 0 && !amend;
  const commit = () => {
    const msg = message.trim();
    if (!msg) return toast.error("Write a commit message first");
    if (commitAll && changes.length === 0) return toast.error("Nothing to commit");
    run("Commit", () => unwrap(g_().commit.post({ message: msg, amend: amend || undefined, all: commitAll || undefined })), "Committed", () => {
      setMessage("");
      setAmend(false);
    });
  };

  const push = (force = false) =>
    run("Push", () => unwrap(g_().push.post({ force: force || undefined })), g.upstream ? "Pushed" : "Branch published");
  const pull = (rebase = false) => run("Pull", () => unwrap(g_().pull.post({ rebase: rebase || undefined })), "Pulled");

  const toggleDiff = (d: DiffTarget) => setDiffTarget(diffKey(diffTarget) === diffKey(d) ? null : d);
  const diffBox = (d: DiffTarget) =>
    diffKey(diffTarget) === diffKey(d) && (
      <div className="overflow-hidden border-t">
        {diff.isLoading ? (
          <p className="p-3 text-sm text-muted-foreground">Loading diff…</p>
        ) : diff.error ? (
          <p className="p-3 text-sm text-destructive">{diff.error.message}</p>
        ) : (
          <DiffView diff={diff.data?.diff ?? ""} />
        )}
      </div>
    );

  const iconBtn = "size-8 shrink-0 max-md:size-9";

  const fileRow = (f: StatusFile, isStaged: boolean) => {
    const l = letterOf(f, isStaged);
    const name = f.path.split("/").pop()!;
    const dir = f.path.slice(0, f.path.length - name.length - 1);
    const target: DiffTarget = { kind: "file", path: f.path, staged: isStaged, untracked: f.untracked };
    const deleted = (isStaged ? f.index : f.worktree) === "D";
    return (
      <li key={`${isStaged}:${f.path}`}>
        <div className="group flex items-center gap-1 py-0.5 pl-3 pr-1 text-sm hover:bg-accent/40">
          <span className={cn("w-4 shrink-0 text-center font-mono text-xs font-bold", l.cls)} title={l.title}>
            {l.label}
          </span>
          <button
            className="flex min-w-0 flex-1 items-baseline gap-2 py-1 text-left"
            title={f.orig ? `${f.orig} → ${f.path}` : f.path}
            onClick={() => toggleDiff(target)}
          >
            <span className={cn("shrink-0 truncate font-mono text-xs", deleted && "line-through")}>{name}</span>
            {dir && <span className="min-w-0 truncate text-xs text-muted-foreground">{dir}</span>}
          </button>
          {!deleted && (
            <Button size="icon" variant="ghost" className={iconBtn} title="Open file" onClick={() => onOpenFile(f.path)}>
              <FileDiff className="size-4" />
            </Button>
          )}
          {isStaged ? (
            <Button size="icon" variant="ghost" className={iconBtn} title="Unstage" disabled={!!busy} onClick={() => unstage([f.path])}>
              <Minus className="size-4" />
            </Button>
          ) : (
            <>
              <Button size="icon" variant="ghost" className={iconBtn} title="Discard changes" disabled={!!busy} onClick={() => discard([f.path], f.path)}>
                <Undo2 className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" className={iconBtn} title="Stage" disabled={!!busy} onClick={() => stage([f.path])}>
                <Plus className="size-4" />
              </Button>
            </>
          )}
        </div>
        {diffBox(target)}
      </li>
    );
  };

  const group = (title: string, list: StatusFile[], isStaged: boolean) =>
    list.length > 0 && (
      <section className="overflow-hidden rounded-lg border">
        <div className="flex items-center gap-1 border-b bg-muted/40 py-0.5 pl-3 pr-1">
          <h3 className="mr-auto text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title} <span className="ml-1 rounded-full bg-muted px-1.5 text-foreground">{list.length}</span>
          </h3>
          <Button size="icon" variant="ghost" className={iconBtn} title="Diff all" onClick={() => toggleDiff({ kind: "all", staged: isStaged })}>
            <FileDiff className="size-4" />
          </Button>
          {isStaged ? (
            <Button size="icon" variant="ghost" className={iconBtn} title="Unstage all" disabled={!!busy} onClick={() => unstage("all")}>
              <Minus className="size-4" />
            </Button>
          ) : (
            <>
              <Button size="icon" variant="ghost" className={iconBtn} title="Discard all changes" disabled={!!busy} onClick={() => discard("all", "all files")}>
                <Undo2 className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" className={iconBtn} title="Stage all" disabled={!!busy} onClick={() => stage("all")}>
                <Plus className="size-4" />
              </Button>
            </>
          )}
        </div>
        {diffBox({ kind: "all", staged: isStaged })}
        <ul className="divide-y divide-border/50">{list.map((f) => fileRow(f, isStaged))}</ul>
      </section>
    );

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl space-y-4 p-3 md:p-4">
        {/* Branch + sync */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-9 max-w-full gap-1.5 font-mono md:h-8" onClick={() => setBranchOpen(true)}>
            <GitBranch className="size-4" />
            <span className="truncate">{g.detached ? "(detached HEAD)" : g.branch || "–"}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
          <Button variant="outline" size="sm" className="h-9 md:h-8" disabled={!!busy || !g.remote} onClick={() => pull()} title="git pull --ff-only">
            <ArrowDown className={cn("size-4", busy === "Pull" && "animate-bounce")} /> Pull
            {g.behind > 0 && <Badge variant="secondary" className="h-5 px-1.5">{g.behind}</Badge>}
          </Button>
          <Button
            variant={g.ahead > 0 || (!g.upstream && g.remote) ? "default" : "outline"}
            size="sm"
            className="h-9 md:h-8"
            disabled={!!busy || !g.remote || g.detached}
            onClick={() => push()}
            title={g.upstream ? "git push" : "git push -u origin HEAD"}
          >
            {g.upstream ? <ArrowUp className={cn("size-4", busy === "Push" && "animate-bounce")} /> : <Upload className="size-4" />}
            {g.upstream ? "Push" : "Publish"}
            {g.ahead > 0 && <Badge variant="secondary" className="h-5 px-1.5">{g.ahead}</Badge>}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 md:size-8"
            disabled={!!busy || !g.remote}
            title="Fetch all remotes"
            onClick={() => run("Fetch", () => unwrap(g_().fetch.post()), "Fetched")}
          >
            <CloudDownload className={cn("size-4", busy === "Fetch" && "animate-pulse")} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-9 md:size-8" title="More">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="max-md:py-2.5" disabled={!g.remote} onClick={() => pull(true)}>
                <ArrowDown /> Pull (rebase)
              </DropdownMenuItem>
              <DropdownMenuItem
                className="max-md:py-2.5"
                disabled={!g.remote || g.detached}
                onClick={() =>
                  setConfirm({
                    title: "Force push?",
                    description: "Overwrites history on the remote (--force-with-lease). Commits by others that you have not fetched are not overwritten.",
                    label: "Force push",
                    action: () => push(true),
                  })
                }
              >
                <ArrowUp /> Force push
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="max-md:py-2.5"
                disabled={files.length === 0}
                onClick={() => run("Stash", () => unwrap(g_().stash.post({ action: "push", message: message.trim() || undefined })), "Changes stashed")}
              >
                <Archive /> Stash changes
              </DropdownMenuItem>
              <DropdownMenuItem
                className="max-md:py-2.5"
                disabled={g.stashCount === 0}
                onClick={() => run("Stash pop", () => unwrap(g_().stash.post({ action: "pop" })), "Stash applied")}
              >
                <ArchiveRestore /> Stash pop {g.stashCount > 0 && `(${g.stashCount})`}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="max-md:py-2.5" onClick={() => setBranchOpen(true)}>
                <GitBranchPlus /> Branch…
              </DropdownMenuItem>
              <DropdownMenuItem className="max-md:py-2.5" onClick={() => git.refetch()}>
                <RefreshCw /> Reload
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {g.remote ? (
            <span className="flex min-w-0 basis-full items-center gap-1 text-xs text-muted-foreground sm:ml-auto sm:basis-auto">
              <Globe className="size-3 shrink-0" />
              <span className="truncate">{g.remote}</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground sm:ml-auto">No remote origin</span>
          )}
        </div>

        {/* Commit box */}
        <div className="space-y-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                commit();
              }
            }}
            rows={message.includes("\n") ? 4 : 2}
            placeholder={`Commit message (Ctrl+Enter) — on ${g.branch || "HEAD"}`}
            className="block w-full resize-y rounded-md border bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
          />
          <div className="flex items-center gap-3">
            <Button className="h-9 flex-1 md:h-8" disabled={!!busy || !message.trim() || (commitAll && changes.length === 0)} onClick={commit}>
              <Check className="size-4" />
              {amend ? "Amend commit" : commitAll ? "Stage all & commit" : `Commit (${staged.length})`}
            </Button>
            <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={amend}
                disabled={g.commits.length === 0}
                onCheckedChange={(v) => {
                  setAmend(v === true);
                  if (v === true && !message.trim()) setMessage(g.commits[0]?.subject ?? "");
                }}
              />
              Amend
            </label>
          </div>
        </div>

        {files.length === 0 && <p className="text-sm text-muted-foreground">Working tree clean.</p>}
        {group("Staged", staged, true)}
        {group("Changes", changes, false)}

        <section>
          <h3 className="mb-2 text-sm font-semibold">Recent commits</h3>
          {g.commits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No commits yet.</p>
          ) : (
            <ul className="overflow-hidden rounded-lg border">
              {g.commits.map((c, i) => (
                <li key={c.hash} className="border-b last:border-0">
                  <button
                    className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent/40"
                    onClick={() => toggleDiff({ kind: "commit", hash: c.hash })}
                  >
                    <GitCommitHorizontal className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{c.subject}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">{c.hash}</span> · {c.author} · {ago(c.date)}
                        {i < g.ahead && <span className="text-primary"> · not pushed</span>}
                      </p>
                    </div>
                    <Search className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                  {diffBox({ kind: "commit", hash: c.hash })}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <BranchDialog
        open={branchOpen}
        onOpenChange={setBranchOpen}
        project={project}
        current={g.branch}
        busy={!!busy}
        onCheckout={(branch, opts) =>
          run(
            "Checkout",
            () => unwrap(g_().checkout.post({ branch, ...opts })),
            opts.create ? `Created branch ${branch}` : `Switched to ${branch}`,
            () => setBranchOpen(false),
          )
        }
        onDelete={(branch) =>
          setConfirm({
            title: `Delete branch ${branch}?`,
            description: "Deletes the local branch. If it is not merged, git refuses unless you choose force delete next.",
            label: "Delete",
            action: () =>
              op.mutate(() => unwrap(g_().branches.remove.post({ branch })), {
                onSuccess: () => toast.success(`Deleted branch ${branch}`),
                onError: (e) =>
                  setConfirm({
                    title: `Force delete ${branch}?`,
                    description: `${e.message.slice(-300)}\n\nCommits that only exist on this branch may be lost.`,
                    label: "Force delete",
                    action: () => run("Delete branch", () => unwrap(g_().branches.remove.post({ branch, force: true })), `Deleted branch ${branch}`),
                  }),
                onSettled: invalidate,
              }),
          })
        }
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.title ?? ""}
        description={<span className="whitespace-pre-wrap">{confirm?.description}</span>}
        confirmLabel={confirm?.label}
        destructive
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          c?.action();
        }}
      />
    </div>
  );
}
