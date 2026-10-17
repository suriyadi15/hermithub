import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, GitBranch, GitFork } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { api, unwrap } from "@/lib/api";
import { cn } from "@/lib/utils";

type Kind = "empty" | "git-init" | "clone";

const KINDS: { id: Kind; label: string; icon: typeof FolderPlus }[] = [
  { id: "git-init", label: "New git repo", icon: GitBranch },
  { id: "clone", label: "Clone from URL", icon: GitFork },
  { id: "empty", label: "Empty folder", icon: FolderPlus },
];

export function NewProjectDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (name: string) => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>("git-init");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (props.open) {
      setName("");
      setUrl("");
    }
  }, [props.open]);

  const create = useMutation({
    mutationFn: () =>
      unwrap(api.projects.post({ type: kind, name: name.trim() || undefined, url: kind === "clone" ? url.trim() : undefined })),
    onSuccess: (r) => {
      toast.success(`Project "${r.name}" created`);
      qc.invalidateQueries({ queryKey: ["projects"] });
      props.onOpenChange(false);
      props.onCreated?.(r.name);
    },
    onError: (e) => toast.error(e.message),
  });

  const valid = kind === "clone" ? url.trim().length > 0 : /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name.trim());

  return (
    <Dialog open={props.open} onOpenChange={(o) => !create.isPending && props.onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Created as a folder inside the projects folder.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                  kind === k.id && "border-primary bg-primary/10 ring-1 ring-primary",
                )}
              >
                <k.icon className="size-5" />
                {k.label}
              </button>
            ))}
          </div>
          {kind === "clone" && (
            <div className="grid gap-2">
              <Label htmlFor="repo-url">URL repository</Label>
              <Input
                id="repo-url"
                autoFocus
                placeholder="https://github.com/user/repo.git or git@github.com:user/repo.git"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="project-name">Folder name{kind === "clone" && " (optional)"}</Label>
            <Input
              id="project-name"
              autoFocus={kind !== "clone"}
              placeholder={kind === "clone" ? "defaults to the repo name" : "my-app"}
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Letters, digits, dots, underscores and dashes.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              {create.isPending ? (kind === "clone" ? "Cloning…" : "Creating…") : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
