import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GitBranch, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, unwrap, type Project, type SessionMode } from "@/lib/api";
import { ago } from "@/lib/format";
import { useModes } from "@/lib/modes";
import { ConfirmDialog, PromptDialog } from "./dialogs";
import { NewSessionDialog } from "./NewSessionDialog";

export function ProjectCard({ project }: { project: Project }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newMode, setNewMode] = useState<SessionMode | null>(null);

  const rename = useMutation({
    mutationFn: (name: string) => unwrap(api.projects({ project: project.name }).patch({ name })),
    onSuccess: (r) => {
      toast.success(`Renamed to "${r.name}"`);
      setRenaming(false);
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e) => toast.error(e.message),
  });
  const trash = useMutation({
    mutationFn: () => unwrap(api.projects({ project: project.name }).delete()),
    onSuccess: () => {
      toast.success(`"${project.name}" moved to trash`);
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["trash"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const git = project.git;
  // Up to three agents plus a terminal; remote control and the rest are in the session dialog.
  const { modes } = useModes();
  const quick = [...modes.filter((m) => m.agent && m.mode !== "rc").slice(0, 3), ...modes.filter((m) => m.mode === "bash")];

  return (
    <div className="group flex min-w-0 flex-col rounded-xl border bg-card p-3 transition-colors hover:border-primary/40 sm:p-4">
      <div className="flex items-start gap-2">
        <Link to={`/p/${encodeURIComponent(project.name)}`} className="min-w-0 flex-1">
          <h3 className="truncate font-semibold group-hover:text-primary">{project.name}</h3>
          <p className="text-xs text-muted-foreground">modified {ago(project.modified)}</p>
        </Link>
        {project.sessions.running > 0 && (
          <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
            {project.sessions.running} running
          </Badge>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="-mr-1.5 -mt-1 size-9 sm:size-8">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setRenaming(true)}>
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
              <Trash2 /> Move to trash
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-2 min-h-10 min-w-0 text-xs text-muted-foreground sm:mt-3">
        {git ? (
          <>
            <div className="flex items-center gap-1.5">
              <GitBranch className="size-3.5" />
              <span className="truncate font-mono text-foreground/80">{git.branch || "–"}</span>
              {git.dirty > 0 && <span className="text-warning">● {git.dirty} changed</span>}
              {git.ahead > 0 && <span>↑{git.ahead}</span>}
              {git.behind > 0 && <span>↓{git.behind}</span>}
            </div>
            {git.lastCommit && (
              <p className="mt-1 truncate">
                <span className="font-mono">{git.lastCommit.hash}</span> {git.lastCommit.subject} · {ago(git.lastCommit.date)}
              </p>
            )}
          </>
        ) : (
          <span>Not a git repository</span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        {quick.map((q) => (
          <Tooltip key={q.mode}>
            <TooltipTrigger asChild>
              <Button size="sm" variant="secondary" className="h-10 min-w-0 flex-1 sm:h-8" onClick={() => setNewMode(q.mode)}>
                <q.icon className="size-4" />
                <span className="truncate">{q.short}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{q.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      <PromptDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename project"
        description="Only possible while no session is running."
        label="New name"
        initial={project.name}
        pending={rename.isPending}
        onSubmit={(name) => rename.mutate(name)}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Move "${project.name}" to trash?`}
        description="The folder is moved to the trash and can be restored from Settings."
        confirmLabel="Move to trash"
        destructive
        onConfirm={() => trash.mutate()}
      />
      <NewSessionDialog
        open={newMode !== null}
        onOpenChange={(o) => !o && setNewMode(null)}
        project={project.name}
        initialMode={newMode ?? undefined}
        onStarted={(name) => navigate(`/p/${encodeURIComponent(project.name)}?s=${name}`)}
      />
    </div>
  );
}
