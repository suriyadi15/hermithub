import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Download,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, unwrap } from "@/lib/api";
import { bytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ConfirmDialog, PromptDialog } from "./dialogs";

type Entry = { name: string; type: "file" | "dir"; size: number; symlink: boolean };

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

function useDir(project: string, path: string, enabled = true) {
  return useQuery({
    queryKey: ["files", project, path],
    queryFn: () => unwrap(api.files.list.get({ query: { project, path } })) as Promise<Entry[]>,
    enabled,
    refetchInterval: 15_000,
  });
}

type Action =
  | { kind: "new"; type: "file" | "dir"; dir: string }
  | { kind: "rename"; path: string }
  | { kind: "delete"; path: string; type: "file" | "dir" };

interface TreeCtx {
  project: string;
  expanded: Set<string>;
  toggle: (path: string) => void;
  selected?: string;
  onOpen: (path: string) => void;
  menu: (entry: Entry, path: string) => React.ReactNode;
}

function Dir({ path, depth, ctx }: { path: string; depth: number; ctx: TreeCtx }) {
  const { project: projectName, expanded, toggle, selected, onOpen, menu } = ctx;
  const q = useDir(projectName, path);
  if (q.isLoading) return <div className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: depth * 12 + 24 }}>…</div>;
  if (q.error) return <div className="py-1 text-xs text-destructive" style={{ paddingLeft: depth * 12 + 24 }}>{q.error.message}</div>;
  return (
    <>
      {q.data?.map((e) => {
        const p = join(path, e.name);
        const open = expanded.has(p);
        return (
          <div key={p}>
            <div
              role="button"
              tabIndex={0}
              title={e.type === "file" ? `${e.name} · ${bytes(e.size)}` : e.name}
              onClick={() => (e.type === "dir" ? toggle(p) : onOpen(p))}
              onKeyDown={(ev) => ev.key === "Enter" && (e.type === "dir" ? toggle(p) : onOpen(p))}
              className={cn(
                "group flex cursor-pointer items-center gap-1 rounded-sm py-[3px] pr-1.5 text-[13px] hover:bg-accent/60 max-md:py-2 max-md:text-sm",
                selected === p && "bg-accent text-accent-foreground",
              )}
              style={{ paddingLeft: depth * 12 + 4 }}
            >
              {e.type === "dir" ? (
                <>
                  <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
                  {open ? <FolderOpen className="size-4 shrink-0 text-primary/80" /> : <Folder className="size-4 shrink-0 text-primary/80" />}
                </>
              ) : (
                <>
                  <span className="w-3.5 shrink-0" />
                  <File className="size-4 shrink-0 text-muted-foreground" />
                </>
              )}
              <span className={cn("truncate", e.symlink && "italic")}>{e.name}</span>
              {menu(e, p)}
            </div>
            {e.type === "dir" && open && <Dir path={p} depth={depth + 1} ctx={ctx} />}
          </div>
        );
      })}
      {q.data?.length === 0 && (
        <div className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: depth * 12 + 24 }}>
          (empty)
        </div>
      )}
    </>
  );
}


export function FileTree(props: {
  project: string;
  selected?: string;
  onOpen: (path: string) => void;
  onQuickOpen?: () => void;
  /** Replaces the "File" title, e.g. with a File/Search switcher. */
  title?: React.ReactNode;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<Action | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadDir = useRef("");

  const refresh = (dir?: string) =>
    qc.invalidateQueries({ queryKey: dir === undefined ? ["files", props.project] : ["files", props.project, dir] });

  const toggle = (path: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  const mutate = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onError: (e) => toast.error(e.message),
  });

  const run = (fn: () => Promise<unknown>, dir: string, msg?: string) =>
    mutate.mutate(fn, {
      onSuccess: () => {
        if (msg) toast.success(msg);
        refresh(dir);
        setAction(null);
      },
    });

  const startUpload = (dir: string) => {
    uploadDir.current = dir;
    uploadRef.current?.click();
  };

  const menu = (entry: Entry, path: string) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="ml-auto rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100 data-[state=open]:opacity-100 max-md:p-1.5 max-md:opacity-70"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {entry.type === "dir" && (
          <>
            <DropdownMenuItem onClick={() => setAction({ kind: "new", type: "file", dir: path })}>
              <FilePlus /> New file
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setAction({ kind: "new", type: "dir", dir: path })}>
              <FolderPlus /> New folder
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => startUpload(path)}>
              <Upload /> Upload here
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {entry.type === "file" && (
          <DropdownMenuItem asChild>
            <a
              href={`/api/files/download?project=${encodeURIComponent(props.project)}&path=${encodeURIComponent(path)}`}
              download
            >
              <Download /> Download
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => setAction({ kind: "rename", path })}>
          <Pencil /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => setAction({ kind: "delete", path, type: entry.type })}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renameFrom = action?.kind === "rename" ? action.path : "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-0.5 border-b px-2 py-1.5 max-md:py-1">
        {props.title ?? <span className="mr-auto text-xs font-semibold uppercase tracking-wide text-muted-foreground">File</span>}
        {props.onQuickOpen && (
          <Button size="icon" variant="ghost" className="size-7 max-md:size-9" title="Find file (Ctrl+P)" onClick={props.onQuickOpen}>
            <Search className="size-4" />
          </Button>
        )}
        <Button size="icon" variant="ghost" className="size-7 max-md:size-9" title="New file" onClick={() => setAction({ kind: "new", type: "file", dir: "" })}>
          <FilePlus className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" className="size-7 max-md:size-9" title="New folder" onClick={() => setAction({ kind: "new", type: "dir", dir: "" })}>
          <FolderPlus className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" className="size-7 max-md:size-9" title="Upload" onClick={() => startUpload("")}>
          <Upload className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" className="size-7 max-md:size-9" title="Reload" onClick={() => refresh()}>
          <RefreshCw className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1">
        <Dir path="" depth={0} ctx={{ project: props.project, expanded, toggle, selected: props.selected, onOpen: props.onOpen, menu }} />
      </div>

      <input
        ref={uploadRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!files.length) return;
          const dir = uploadDir.current;
          run(
            () => unwrap(api.files.upload.post({ project: props.project, path: dir, files: files as any })),
            dir,
            `${files.length} file(s) uploaded`,
          );
        }}
      />

      <PromptDialog
        open={action?.kind === "new"}
        onOpenChange={(o) => !o && setAction(null)}
        title={action?.kind === "new" && action.type === "dir" ? "New folder" : "New file"}
        description={action?.kind === "new" && action.dir ? `Inside ${action.dir}/` : "In the project root"}
        label="Name (use / for subfolders)"
        confirmLabel="Create"
        onSubmit={(name) => {
          if (action?.kind !== "new") return;
          const path = join(action.dir, name);
          run(() => unwrap(api.files.create.post({ project: props.project, path, type: action.type })), action.dir);
          if (action.dir) setExpanded((s) => new Set(s).add(action.dir));
          if (action.type === "file") props.onOpen(path);
        }}
      />
      <PromptDialog
        open={action?.kind === "rename"}
        onOpenChange={(o) => !o && setAction(null)}
        title="Rename"
        label="New path (relative to the project)"
        initial={renameFrom}
        onSubmit={(to) =>
          run(() => unwrap(api.files.rename.post({ project: props.project, from: renameFrom, to })), parentOf(renameFrom))
        }
      />
      <ConfirmDialog
        open={action?.kind === "delete"}
        onOpenChange={(o) => !o && setAction(null)}
        title={`Delete ${action?.kind === "delete" ? action.path : ""}?`}
        description={
          action?.kind === "delete" && action.type === "dir"
            ? "The folder and everything in it will be deleted permanently."
            : "The file will be deleted permanently."
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (action?.kind !== "delete") return;
          run(() => unwrap(api.files.delete({}, { query: { project: props.project, path: action.path } })), parentOf(action.path));
        }}
      />
    </div>
  );
}
