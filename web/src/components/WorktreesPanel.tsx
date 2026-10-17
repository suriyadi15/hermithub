import { FolderOpen, GitBranch, GitMerge, Plus, SquareTerminal, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ago } from "@/lib/format";
import { useCreateWorktree, useMerge, useRemoveWorktree, useWorktrees } from "@/lib/queries";
import { cn, worktreeName } from "@/lib/utils";
import { ConfirmDialog } from "./dialogs";

type Worktree = NonNullable<NonNullable<ReturnType<typeof useWorktrees>["data"]>["main"]>;

/**
 * Worktrees of a project: one folder and branch per task, so several agents can work in parallel.
 * Open one to point the file tree, search and Git panel at it; merge it back and remove it when done.
 */
export function WorktreesPanel(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: string;
  /** Worktree shown in the work area, null = the project folder. */
  current: string | null;
  onSelect: (worktree: string | null) => void;
  onNewSession: (worktree: string | null) => void;
}) {
  const wts = useWorktrees(props.project, props.open);
  const create = useCreateWorktree(props.project);
  const remove = useRemoveWorktree(props.project);
  const merge = useMerge(props.project);
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState("");
  const [removing, setRemoving] = useState<Worktree | null>(null);
  const [merging, setMerging] = useState<Worktree | null>(null);
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [force, setForce] = useState(false);
  const data = wts.data;
  const main = data?.repo ? data.main : null;

  useEffect(() => {
    if (!removing) return;
    setDeleteBranch(true);
    setForce(false);
  }, [removing]);

  const name = worktreeName(branch);
  const submitCreate = () =>
    create.mutate(
      { name, branch: branch.trim(), base: base.trim() || undefined },
      {
        onSuccess: (r) => {
          setBranch("");
          setBase("");
          props.onSelect(r.name);
        },
      },
    );

  const row = (w: Worktree) => {
    const isCurrent = (w.name ?? null) === props.current;
    return (
      <li key={w.name ?? ""} className={cn("grid gap-2 px-3 py-3", isCurrent && "bg-primary/5")}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">
            {w.name ?? "Project folder"}
            {isCurrent && <span className="ml-2 text-xs font-normal text-primary">shown</span>}
          </span>
          {w.sessions.running > 0 && (
            <span className="text-xs text-success">
              {w.sessions.running} session{w.sessions.running > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1 font-mono text-foreground/80">
            <GitBranch className="size-3" />
            <span className="truncate">{w.branch ?? `detached ${w.head}`}</span>
          </span>
          {!!w.git?.dirty && <span className="text-warning">● {w.git.dirty} changed</span>}
          {!!w.git?.ahead && <span>↑{w.git.ahead}</span>}
          {!!w.git?.behind && <span>↓{w.git.behind}</span>}
          {w.git?.lastCommit && (
            <span className="min-w-0 truncate">
              {w.git.lastCommit.subject} · {ago(w.git.lastCommit.date)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={isCurrent ? "secondary" : "outline"}
            className="h-9 sm:h-7"
            onClick={() => {
              props.onSelect(w.name ?? null);
              props.onOpenChange(false);
            }}
          >
            <FolderOpen /> Open
          </Button>
          <Button size="sm" variant="outline" className="h-9 sm:h-7" onClick={() => props.onNewSession(w.name ?? null)}>
            <SquareTerminal /> New session
          </Button>
          {w.name && w.branch && main?.branch && (
            <Button size="sm" variant="outline" className="h-9 sm:h-7" onClick={() => setMerging(w)}>
              <GitMerge /> Merge into {main.branch}
            </Button>
          )}
          {w.name && (
            <Button
              size="sm"
              variant="ghost"
              className="h-9 text-destructive hover:text-destructive sm:h-7"
              onClick={() => setRemoving(w)}
            >
              <Trash2 /> Remove
            </Button>
          )}
        </div>
      </li>
    );
  };

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Worktrees · {props.project}</SheetTitle>
          <SheetDescription>
            Each task gets its own folder and branch, sharing this project's git history. Sessions in different
            worktrees never touch each other's files.
          </SheetDescription>
        </SheetHeader>

        {data && !data.repo && <p className="p-4 text-sm text-muted-foreground">This project is not a git repository.</p>}
        {data?.repo && (
          <>
            <form
              className="grid gap-2 border-b p-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (name) submitCreate();
              }}
            >
              <Label htmlFor="wt-new-branch">New worktree</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="wt-new-branch"
                  className="min-w-40 flex-1"
                  placeholder="Branch, e.g. feat/login"
                  value={branch}
                  maxLength={100}
                  onChange={(e) => setBranch(e.target.value)}
                />
                <Input
                  className="w-32"
                  placeholder={main?.branch ?? "HEAD"}
                  aria-label="Start from"
                  title="Start from this branch or commit"
                  value={base}
                  maxLength={100}
                  onChange={(e) => setBase(e.target.value)}
                />
                <Button type="submit" disabled={!name || create.isPending}>
                  <Plus /> {create.isPending ? "Creating…" : "Create"}
                </Button>
              </div>
              {name && <p className="text-xs text-muted-foreground">Folder "{name}". An existing branch is checked out as is.</p>}
            </form>
            <ul className="divide-y">
              {data.main && row(data.main)}
              {data.worktrees.map(row)}
            </ul>
            {data.worktrees.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                No worktrees yet. Create one above, or pick "New worktree" when starting a session.
              </p>
            )}
          </>
        )}
      </SheetContent>

      <ConfirmDialog
        open={merging !== null}
        onOpenChange={(o) => !o && setMerging(null)}
        title={`Merge ${merging?.branch} into ${main?.branch}?`}
        description={`Runs "git merge ${merging?.branch}" in the project folder. Commit the work in the worktree first; uncommitted changes are not merged. On conflicts, resolve them in the project folder's Git panel.`}
        confirmLabel="Merge"
        onConfirm={() => merging?.branch && merge.mutate({ into: props.project, branch: merging.branch })}
      />

      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove worktree {removing?.name}?</DialogTitle>
            <DialogDescription>
              Deletes the folder. Commits stay in the repository as long as the branch is kept or merged.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={deleteBranch} onCheckedChange={(v) => setDeleteBranch(v === true)} />
            Also delete branch <span className="font-mono">{removing?.branch}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={force} onCheckedChange={(v) => setForce(v === true)} />
            Force: discard uncommitted changes{deleteBranch ? " and unmerged commits" : ""}
          </label>
          {!!removing?.git?.dirty && !force && (
            <p className="text-xs text-warning">It has {removing.git.dirty} uncommitted change(s); git will refuse without Force.</p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                removing?.name &&
                remove.mutate(
                  { name: removing.name, force, deleteBranch },
                  {
                    onSuccess: () => {
                      if (props.current === removing.name) props.onSelect(null);
                      setRemoving(null);
                    },
                  },
                )
              }
            >
              {remove.isPending ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
