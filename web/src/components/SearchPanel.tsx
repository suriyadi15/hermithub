import { useQuery } from "@tanstack/react-query";
import { CaseSensitive, ChevronRight, File, Regex, WholeWord, X } from "lucide-react";
import { useState } from "react";
import { useDebounced } from "@/hooks/use-debounced";
import { api, unwrap } from "@/lib/api";
import { cn } from "@/lib/utils";

type Match = { line: number; text: string; ranges: [number, number][] };

function Highlighted({ m }: { m: Match }) {
  // Trim long leading whitespace / context so the hit stays visible in a narrow sidebar.
  const first = m.ranges[0]?.[0] ?? 0;
  const lead = m.text.match(/^\s*/)![0].length;
  const start = Math.max(lead, first > 40 ? first - 30 : 0);
  const parts: { t: string; hit: boolean }[] = [];
  let pos = start;
  for (const [a, b] of m.ranges) {
    if (b <= pos) continue;
    if (a > pos) parts.push({ t: m.text.slice(pos, a), hit: false });
    parts.push({ t: m.text.slice(Math.max(a, pos), b), hit: true });
    pos = b;
  }
  parts.push({ t: m.text.slice(pos), hit: false });
  return (
    <>
      {start > lead && "…"}
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-primary/30 text-foreground">
            {p.t}
          </mark>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </>
  );
}

const toggleCls = (on: boolean) =>
  cn(
    "flex size-7 shrink-0 items-center justify-center rounded border max-md:size-9",
    on ? "border-primary bg-primary/20 text-foreground" : "border-transparent text-muted-foreground hover:bg-accent",
  );

/** Find in files (ripgrep on the server); clicking a hit opens the file at that line. */
export function SearchPanel(props: { project: string; onOpen: (path: string, line?: number, cols?: [number, number]) => void }) {
  const [q, setQ] = useState("");
  const [regex, setRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [word, setWord] = useState(false);
  const [glob, setGlob] = useState("");
  const [showGlob, setShowGlob] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const dq = useDebounced(q, 300);
  const dglob = useDebounced(glob, 300);

  const res = useQuery({
    queryKey: ["search-text", props.project, dq, regex, matchCase, word, dglob],
    queryFn: () =>
      unwrap(
        api.search.text.get({
          query: {
            project: props.project,
            q: dq,
            regex: regex ? "true" : undefined,
            case: matchCase ? "true" : undefined,
            word: word ? "true" : undefined,
            glob: dglob.trim() || undefined,
          } as any,
        }),
      ),
    enabled: dq.length > 0,
    placeholderData: (prev) => prev,
    staleTime: 5_000,
  });
  const data = dq ? res.data : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-1.5 border-b p-2">
        <div className="flex items-center gap-1 rounded-md border bg-background pr-1 focus-within:ring-2 focus-within:ring-ring">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search all files…"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            enterKeyHint="search"
            className="h-9 min-w-0 flex-1 bg-transparent px-2.5 text-base outline-none sm:text-sm"
          />
          {q && (
            <button className="p-1 text-muted-foreground" onClick={() => setQ("")} aria-label="Clear">
              <X className="size-4" />
            </button>
          )}
          <button className={toggleCls(matchCase)} title="Huruf besar/kecil" onClick={() => setMatchCase((v) => !v)}>
            <CaseSensitive className="size-4" />
          </button>
          <button className={toggleCls(word)} title="Kata utuh" onClick={() => setWord((v) => !v)}>
            <WholeWord className="size-4" />
          </button>
          <button className={toggleCls(regex)} title="Regex" onClick={() => setRegex((v) => !v)}>
            <Regex className="size-4" />
          </button>
        </div>
        {showGlob ? (
          <input
            value={glob}
            onChange={(e) => setGlob(e.target.value)}
            placeholder="Filter files, e.g. *.ts, src/**, !*.test.ts"
            spellCheck={false}
            autoCapitalize="off"
            className="h-8 w-full rounded-md border bg-background px-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-xs"
          />
        ) : (
          <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowGlob(true)}>
            + filter file
          </button>
        )}
        {data && (
          <p className="text-xs text-muted-foreground">
            {data.total === 0
              ? "No results."
              : `${data.total}${data.truncated ? "+" : ""} results in ${data.files.length} files`}
            {res.isFetching && " · mencari…"}
          </p>
        )}
        {res.error && <p className="whitespace-pre-wrap text-xs text-destructive">{res.error.message}</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {data?.files.map((f) => {
          const closed = collapsed.has(f.path);
          const name = f.path.split("/").pop()!;
          const dir = f.path.slice(0, f.path.length - name.length - 1);
          return (
            <div key={f.path}>
              <button
                className="flex w-full items-center gap-1 px-1.5 py-1 text-left text-[13px] hover:bg-accent/60 max-md:py-2"
                onClick={() =>
                  setCollapsed((s) => {
                    const n = new Set(s);
                    if (n.has(f.path)) n.delete(f.path);
                    else n.add(f.path);
                    return n;
                  })
                }
              >
                <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !closed && "rotate-90")} />
                <File className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="shrink-0 font-medium">{name}</span>
                <span className="min-w-0 truncate text-xs text-muted-foreground">{dir}</span>
                <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 text-[10px] leading-4">{f.matches.length}</span>
              </button>
              {!closed &&
                f.matches.map((m) => (
                  <button
                    key={m.line}
                    className="flex w-full items-baseline gap-2 py-0.5 pl-8 pr-2 text-left hover:bg-accent/60 max-md:py-1.5"
                    onClick={() => props.onOpen(f.path, m.line, m.ranges[0])}
                  >
                    <span className="w-7 shrink-0 text-right font-mono text-[10px] text-muted-foreground">{m.line}</span>
                    <span className="min-w-0 truncate whitespace-pre font-mono text-xs">
                      <Highlighted m={m} />
                    </span>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
