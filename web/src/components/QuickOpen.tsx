import { useQuery } from "@tanstack/react-query";
import { File } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useDebounced } from "@/hooks/use-debounced";
import { api, unwrap } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Ctrl+P style file finder: fuzzy match on paths (server side, respects .gitignore). */
export function QuickOpen(props: { open: boolean; onOpenChange: (open: boolean) => void; project: string; onOpen: (path: string) => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const dq = useDebounced(q, 120);
  const files = useQuery({
    queryKey: ["search-files", props.project, dq],
    queryFn: () => unwrap(api.search.files.get({ query: { project: props.project, q: dq } })),
    enabled: props.open,
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
  const list = files.data ?? [];

  useEffect(() => setSel(0), [dq]);
  useEffect(() => {
    if (!props.open) setQ("");
  }, [props.open]);
  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const pick = (path: string | undefined) => {
    if (!path) return;
    props.onOpenChange(false);
    props.onOpen(path);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 max-sm:h-[75dvh] max-sm:p-0 sm:top-[12%] sm:max-h-[75vh] sm:max-w-xl sm:translate-y-0" showCloseButton={false}>
        <DialogTitle className="sr-only">Find file</DialogTitle>
        <DialogDescription className="sr-only">Type part of a file name or path</DialogDescription>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, list.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(list[sel]);
            }
          }}
          placeholder="Find a file by name…"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="h-12 shrink-0 border-b bg-transparent px-4 text-base outline-none sm:text-sm"
        />
        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {list.map((p, i) => {
            const name = p.split("/").pop()!;
            const dir = p.slice(0, p.length - name.length - 1);
            return (
              <li key={p}>
                <button
                  className={cn("flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm max-md:py-2.5", i === sel && "bg-accent")}
                  onMouseMove={() => setSel(i)}
                  onClick={() => pick(p)}
                >
                  <File className="size-4 shrink-0 text-muted-foreground" />
                  <span className="shrink-0 font-mono text-[13px]">{name}</span>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">{dir}</span>
                </button>
              </li>
            );
          })}
          {!files.isLoading && list.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No matching files.</li>}
          {files.error && <li className="px-4 py-3 text-sm text-destructive">{files.error.message}</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
