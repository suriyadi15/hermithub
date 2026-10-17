import { useEffect, useState } from "react";
import { Link } from "react-router";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SessionMode } from "@/lib/api";
import { useModes } from "@/lib/modes";
import { useStartSession, useWorktrees } from "@/lib/queries";
import { cn, worktreeName } from "@/lib/utils";

const RISKY = new Set(["bypassPermissions", "yolo"]);
const NEW_WORKTREE = "__new";

export function NewSessionDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: string;
  initialMode?: SessionMode;
  /** Worktree to preselect (null = the project folder). */
  initialWorktree?: string | null;
  onStarted?: (name: string) => void;
}) {
  const { modes, info, hasAgents } = useModes();
  const start = useStartSession();
  const firstMode = props.initialMode ?? modes[0]?.mode ?? "bash";
  const [mode, setMode] = useState<SessionMode>(firstMode);
  const [permission, setPermission] = useState("");
  const [label, setLabel] = useState("");
  const [resume, setResume] = useState(false);
  const [spawn, setSpawn] = useState<"same-dir" | "worktree">("same-dir");
  const agent = info(mode).agent;
  const worktrees = useWorktrees(props.project, props.open);
  const repo = worktrees.data?.repo ? worktrees.data : null;
  const [where, setWhere] = useState("");
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState("");
  const isNew = where === NEW_WORKTREE;
  const newName = worktreeName(branch);

  useEffect(() => {
    if (!props.open) return;
    setMode(firstMode);
    setLabel("");
    setResume(false);
    setSpawn("same-dir");
    setWhere(props.initialWorktree ?? "");
    setBranch("");
    setBase("");
  }, [props.open, firstMode, props.initialWorktree]);

  // Each agent has its own permission modes; start from the default saved in Settings.
  useEffect(() => {
    setPermission(agent?.defaultPermission ?? "");
  }, [agent?.id, agent?.defaultPermission]);

  const submit = () =>
    start.mutate(
      {
        project: props.project,
        mode,
        permission: agent ? permission || undefined : undefined,
        label: label.trim() || undefined,
        resume: !!agent && resume && !isNew,
        spawn: mode === "rc" ? spawn : undefined,
        worktree: !isNew && where ? where : undefined,
        newWorktree: isNew ? { name: newName, branch: branch.trim(), base: base.trim() || undefined } : undefined,
      },
      {
        onSuccess: (r) => {
          props.onOpenChange(false);
          props.onStarted?.(r.name);
        },
      },
    );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New session · {props.project}</DialogTitle>
          <DialogDescription>Sessions keep running when you close the browser.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {modes.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.mode}
                type="button"
                onClick={() => setMode(m.mode)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:flex-col sm:items-start sm:gap-1",
                  mode === m.mode && "border-primary bg-primary/10 ring-1 ring-primary",
                )}
              >
                <Icon className="size-5 shrink-0" />
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-medium">{m.label}</span>
                  <span className="text-xs text-muted-foreground">{m.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        {!hasAgents && (
          <p className="text-sm text-muted-foreground">
            No AI agent installed yet.{" "}
            <Link to="/settings" className="text-primary hover:underline" onClick={() => props.onOpenChange(false)}>
              Install one in Settings
            </Link>
            .
          </p>
        )}

        {agent && (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Permission mode</Label>
              <Select value={permission} onValueChange={setPermission}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {agent.permissionModes.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {RISKY.has(permission) && (
                <p className="text-xs text-destructive">
                  {agent.name} will run any command in this container without asking.
                </p>
              )}
              {!agent.loggedIn && !agent.apiKey?.hint && (
                <p className="text-xs text-warning">
                  {agent.name} is not logged in yet. It will ask you to sign in, or{" "}
                  <Link to="/settings" className="underline" onClick={() => props.onOpenChange(false)}>
                    log in from Settings
                  </Link>
                  .
                </p>
              )}
            </div>
            {mode === "rc" && !resume && (
              <div className="grid gap-2">
                <Label>New sessions started from claude.ai run in</Label>
                <Select value={spawn} onValueChange={(v) => setSpawn(v as "same-dir" | "worktree")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="same-dir">The same folder (same-dir)</SelectItem>
                    <SelectItem value="worktree">A separate git worktree per session (worktree)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {!isNew && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={resume} onCheckedChange={(v) => setResume(v === true)} />
                Continue the last conversation in this {where ? "worktree" : "project"}
              </label>
            )}
          </div>
        )}

        {repo && (
          <div className="grid gap-2">
            <Label>Run in</Label>
            <Select value={where || "main"} onValueChange={(v) => setWhere(v === "main" ? "" : v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="main">Project folder ({repo.main?.branch ?? "detached"})</SelectItem>
                {repo.worktrees.map((w) => (
                  <SelectItem key={w.name} value={w.name!}>
                    Worktree {w.name} ({w.branch ?? "detached"})
                  </SelectItem>
                ))}
                <SelectItem value={NEW_WORKTREE}>+ New worktree (separate folder and branch)…</SelectItem>
              </SelectContent>
            </Select>
            {isNew && (
              <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="wt-branch">New branch</Label>
                  <Input
                    id="wt-branch"
                    autoFocus
                    placeholder="e.g. feat/login"
                    value={branch}
                    maxLength={100}
                    onChange={(e) => setBranch(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="wt-base">From</Label>
                  <Input
                    id="wt-base"
                    placeholder={repo.main?.branch ?? "HEAD"}
                    value={base}
                    maxLength={100}
                    onChange={(e) => setBase(e.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  {newName
                    ? `Folder "${newName}" on branch "${branch.trim()}". An existing branch is checked out as is.`
                    : "Each task gets its own folder and branch, so sessions do not touch each other's files."}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-2">
          <Label htmlFor="session-label">Label (optional)</Label>
          <Input
            id="session-label"
            placeholder={mode === "rc" ? `Name on claude.ai (default: ${props.project})` : "e.g. login feature"}
            value={label}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={start.isPending || (isNew && !newName)}>
            {start.isPending ? "Starting…" : "Start"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
