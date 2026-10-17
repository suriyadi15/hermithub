import { CaseSensitive, ChevronDown, ChevronUp, Replace, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Jump target: 1-based line, optional [start, end) columns (0-based); `seq` is unique per request. */
export type Reveal = { line: number; cols?: [number, number]; seq: number };

const MAX_MATCHES = 10_000;
// Shared by the textarea and the highlight layer behind it, so both lay out text identically.
const TEXT = "p-3 font-mono text-[13px] leading-relaxed [tab-size:2] max-sm:text-base whitespace-pre";

let lastReveal = 0;
let lastFind = 0;

function findAll(text: string, q: string, matchCase: boolean) {
  if (!q) return [];
  const hay = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? q : q.toLowerCase();
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i >= 0 && out.length < MAX_MATCHES; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}

const iconBtn =
  "flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 max-md:size-9";

/**
 * Lightweight editor for touch devices, where Monaco's custom input handling fights the
 * on-screen keyboard (autocorrect, selection handles, IME). No syntax highlighting, but reliable
 * typing, plus a find/replace bar whose hits are drawn on a layer behind the transparent textarea.
 */
export function PlainEditor(props: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  reveal?: Reveal;
  /** Changes whenever the toolbar's "find" button is pressed. */
  findSeq?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const layerRef = useRef<HTMLPreElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [current, setCurrent] = useState(0);

  const matches = useMemo(
    () => (findOpen ? findAll(props.value, query, matchCase) : []),
    [findOpen, props.value, query, matchCase],
  );
  const idx = matches.length ? Math.min(current, matches.length - 1) : -1;

  const syncLayer = () => {
    const el = ref.current;
    if (layerRef.current && el) layerRef.current.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
  };

  /** Scroll the textarea so the offset range is centred, and select it. */
  const scrollTo = (start: number, end: number, focus: boolean) => {
    const el = ref.current;
    if (!el) return;
    const before = props.value.slice(0, start);
    const line = before.split("\n").length - 1;
    const col = start - (before.lastIndexOf("\n") + 1);
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || 20;
    const charW = parseFloat(cs.fontSize) * 0.6; // monospace advance ≈ 0.6em
    el.scrollTop = Math.max(0, line * lh - el.clientHeight / 2);
    el.scrollLeft = Math.max(0, col * charW - el.clientWidth / 2);
    if (focus) el.focus({ preventScroll: true });
    el.setSelectionRange(start, end);
    syncLayer();
  };

  const go = (i: number) => {
    if (!matches.length) return;
    const n = (i + matches.length) % matches.length;
    setCurrent(n);
    scrollTo(matches[n]!, matches[n]! + query.length, false);
  };

  // New query: jump to the first hit at or after the cursor.
  useEffect(() => {
    if (!matches.length) return;
    const caret = ref.current?.selectionStart ?? 0;
    const i = matches.findIndex((m) => m >= caret - query.length);
    go(i < 0 ? 0 : i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, matchCase]);

  useLayoutEffect(syncLayer);

  const openFind = () => {
    const el = ref.current;
    const sel = el ? el.value.slice(el.selectionStart, el.selectionEnd) : "";
    if (sel && !sel.includes("\n")) setQuery(sel);
    setFindOpen(true);
    requestAnimationFrame(() => findRef.current?.select());
  };

  useEffect(() => {
    if (!props.findSeq || props.findSeq <= lastFind) return;
    lastFind = props.findSeq;
    openFind();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.findSeq]);

  useEffect(() => {
    const r = props.reveal;
    if (!r || r.seq <= lastReveal) return;
    lastReveal = r.seq;
    const lines = props.value.split("\n");
    const start = lines.slice(0, r.line - 1).reduce((n, l) => n + l.length + 1, 0);
    const [a, b] = r.cols ?? [0, 0];
    requestAnimationFrame(() => scrollTo(start + a, start + b, !window.matchMedia("(pointer: coarse)").matches));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.reveal?.seq]);

  const replaceOne = () => {
    if (idx < 0) return;
    const at = matches[idx]!;
    props.onChange(props.value.slice(0, at) + replacement + props.value.slice(at + query.length));
    // The next hit now sits at the same index (or wraps).
    requestAnimationFrame(() => {
      const el = ref.current;
      el?.setSelectionRange(at + replacement.length, at + replacement.length);
    });
  };

  const replaceAll = () => {
    if (!matches.length) return;
    let out = "";
    let pos = 0;
    for (const m of matches) {
      out += props.value.slice(pos, m) + replacement;
      pos = m + query.length;
    }
    props.onChange(out + props.value.slice(pos));
  };

  // Highlight layer: only while there are hits, so plain typing does not pay for a second copy of the text.
  const layer =
    findOpen && matches.length > 0 ? (
      <pre ref={layerRef} aria-hidden className={cn(TEXT, "pointer-events-none absolute left-0 top-0 m-0 text-transparent")}>
        {(() => {
          const parts: React.ReactNode[] = [];
          let pos = 0;
          matches.forEach((m, i) => {
            parts.push(props.value.slice(pos, m));
            parts.push(
              <mark key={i} className={cn("rounded-sm text-transparent", i === idx ? "bg-primary/60" : "bg-warning/30")}>
                {props.value.slice(m, m + query.length)}
              </mark>,
            );
            pos = m + query.length;
          });
          parts.push(props.value.slice(pos) + "\n");
          return parts;
        })()}
      </pre>
    ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {findOpen && (
        <div className="shrink-0 space-y-1 border-b bg-card px-2 py-1">
          <div className="flex items-center gap-0.5">
            <button className={iconBtn} title="Replace" onClick={() => setShowReplace((v) => !v)}>
              <Replace className={cn("size-4", showReplace && "text-primary")} />
            </button>
            <input
              ref={findRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  go(idx + (e.shiftKey ? -1 : 1));
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setFindOpen(false);
                  ref.current?.focus();
                }
              }}
              placeholder="Find…"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              enterKeyHint="search"
              className="h-8 min-w-0 flex-1 rounded border bg-background px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
            />
            <span className="w-16 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
              {query ? (matches.length ? `${idx + 1}/${matches.length}${matches.length >= MAX_MATCHES ? "+" : ""}` : "0") : ""}
            </span>
            <button className={cn(iconBtn, matchCase && "bg-primary/20 text-foreground")} title="Huruf besar/kecil" onClick={() => setMatchCase((v) => !v)}>
              <CaseSensitive className="size-4" />
            </button>
            <button className={iconBtn} title="Previous (Shift+Enter)" disabled={!matches.length} onClick={() => go(idx - 1)}>
              <ChevronUp className="size-4" />
            </button>
            <button className={iconBtn} title="Next (Enter)" disabled={!matches.length} onClick={() => go(idx + 1)}>
              <ChevronDown className="size-4" />
            </button>
            <button className={iconBtn} title="Close (Esc)" onClick={() => setFindOpen(false)}>
              <X className="size-4" />
            </button>
          </div>
          {showReplace && (
            <div className="flex items-center gap-1 pl-[34px] max-md:pl-[38px]">
              <input
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    replaceOne();
                  }
                }}
                placeholder="Replace with…"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className="h-8 min-w-0 flex-1 rounded border bg-background px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
              />
              <button className="h-8 shrink-0 rounded px-2 text-xs hover:bg-accent disabled:opacity-40" disabled={idx < 0} onClick={replaceOne}>
                Replace
              </button>
              <button className="h-8 shrink-0 rounded px-2 text-xs hover:bg-accent disabled:opacity-40" disabled={!matches.length} onClick={replaceAll}>
                All
              </button>
            </div>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-terminal">
        {layer}
        <textarea
          ref={ref}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          onScroll={syncLayer}
          onKeyDown={(e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.key.toLowerCase() === "s") {
              e.preventDefault();
              props.onSave();
            } else if (mod && (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "h")) {
              e.preventDefault();
              if (e.key.toLowerCase() === "h") setShowReplace(true);
              openFind();
            } else if (e.key === "Escape" && findOpen) {
              setFindOpen(false);
            } else if (e.key === "F3" || (mod && e.key.toLowerCase() === "g")) {
              e.preventDefault();
              if (findOpen) go(idx + (e.shiftKey ? -1 : 1));
              else openFind();
            } else if (e.key === "Tab" && !e.shiftKey) {
              e.preventDefault();
              const el = e.currentTarget;
              const { selectionStart: a, selectionEnd: b } = el;
              props.onChange(el.value.slice(0, a) + "  " + el.value.slice(b));
              requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
            }
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          wrap="off"
          className={cn(
            TEXT,
            "relative block h-full w-full resize-none overflow-auto bg-transparent text-zinc-200 outline-none selection:bg-primary/40",
          )}
        />
      </div>
    </div>
  );
}
