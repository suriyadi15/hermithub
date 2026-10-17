import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { ArrowDown, ChevronsDown, ChevronsUp, Copy, CornerDownLeft, Keyboard, PenLine, RotateCw, SendHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useIsTouch } from "@/hooks/use-mobile";
import { api, unwrap, wsUrl } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

const MSG_INPUT = 0;
const MSG_RESIZE = 1;
const MSG_SCROLL = 2;
const enc = new TextEncoder();

type Status = "connecting" | "open" | "closed" | "ended";

type Key = { label: string; seq?: string; title?: string; scroll?: "up" | "down" | "exit"; ctrl?: true };

const KEYS: Key[] = [
  { label: "Esc", seq: "\x1b" },
  { label: "Tab", seq: "\t" },
  { label: "⇧Tab", seq: "\x1b[Z", title: "Shift+Tab (switch agent mode)" },
  { label: "Ctrl", ctrl: true, title: "Sticky Ctrl: tap, then type a letter" },
  { label: "↑", seq: "\x1b[A" },
  { label: "↓", seq: "\x1b[B" },
  { label: "←", seq: "\x1b[D" },
  { label: "→", seq: "\x1b[C" },
  { label: "^C", seq: "\x03" },
  { label: "history ▲", scroll: "up", title: "Scroll history up" },
  { label: "▼", scroll: "down", title: "Scroll history down" },
  { label: "✕ scroll", scroll: "exit", title: "Leave scroll mode" },
  { label: "PgUp", seq: "\x1b[5~" },
  { label: "PgDn", seq: "\x1b[6~" },
  { label: "^D", seq: "\x04" },
  { label: "^R", seq: "\x12" },
  { label: "Enter", seq: "\r" },
];

/** Ctrl+<key> as the terminal byte: a→0x01 … z→0x1a, plus @ [ \ ] ^ _ and space. */
function ctrlOf(ch: string): string | null {
  if (ch.length !== 1) return null;
  const c = ch.toUpperCase().charCodeAt(0);
  if (c >= 64 && c <= 95) return String.fromCharCode(c - 64);
  if (ch === " ") return "\x00";
  return null;
}

async function copyWithToast(text: string, what = "Text copied") {
  if (!text) return;
  if (await copyText(text)) toast.success(what, { duration: 1500 });
  else toast.error("Could not copy to the clipboard");
}

/** Decode the base64 payload of an OSC 52 clipboard request ("c;<base64>") as UTF-8. */
function osc52Text(data: string): string | null {
  const b64 = data.slice(data.indexOf(";") + 1);
  if (!b64 || b64 === "?") return null; // "?" = query, never answered
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/**
 * Plain-text scrollback from tmux in a native, selectable view: the only reliable way to select
 * text on phones (drags scroll the terminal) and to copy output older than the visible screen.
 */
function CopyView({ name, onClose }: { name: string; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const load = () => {
    setError(null);
    unwrap(api.sessions({ name }).capture.get({ query: { lines: 5000 } }))
      .then((r) => setText(r.text))
      .catch((e: Error) => setError(e.message));
  };
  useEffect(load, [name]);
  useEffect(() => {
    const el = preRef.current?.parentElement;
    if (el && text !== null) el.scrollTop = el.scrollHeight;
  }, [text]);

  const selection = () => {
    const sel = window.getSelection();
    return sel && preRef.current && sel.anchorNode && preRef.current.contains(sel.anchorNode) ? sel.toString() : "";
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-terminal">
      <div className="flex shrink-0 items-center gap-1 border-b bg-card px-2 py-1">
        <span className="mr-auto truncate text-xs text-muted-foreground">Select text (long-press on phones), then copy</span>
        <Button size="sm" variant="ghost" className="h-9 px-2 sm:h-8" onClick={load} title="Reload">
          <RotateCw className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-9 px-2.5 sm:h-8"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const t = selection();
            if (t) copyWithToast(t);
            else toast.info("No text selected");
          }}
        >
          <Copy className="size-4" /> Pilihan
        </Button>
        <Button size="sm" variant="secondary" className="h-9 px-2.5 sm:h-8" onClick={() => copyWithToast(text ?? "", "All text copied")}>
          <Copy className="size-4" /> All
        </Button>
        <Button size="icon" variant="ghost" className="size-9 sm:size-8" onClick={onClose} title="Close">
          <X className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        {error ? (
          <p className="p-3 text-sm text-destructive">{error}</p>
        ) : text === null ? (
          <p className="p-3 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <pre
            ref={preRef}
            className="min-w-max select-text p-3 font-mono text-xs leading-snug text-zinc-200 [-webkit-user-select:text] [-webkit-touch-callout:default]"
          >
            {text || " "}
          </pre>
        )}
      </div>
    </div>
  );
}

/**
 * Wheel and touch-drag scrolling, translated into "scroll N lines" requests for the server (tmux holds
 * the history; xterm.js only shows the current screen). Returns a cleanup function.
 */
function attachScrolling(el: HTMLElement, term: Terminal, scroll: (dir: "up" | "down", lines: number) => void) {
  const lineHeight = () => (term.options.fontSize ?? 13) * (term.options.lineHeight ?? 1.2);
  let pending = 0; // px; positive = towards older output
  let raf = 0;
  const flush = () => {
    raf = 0;
    const lines = Math.trunc(pending / lineHeight());
    if (!lines) return;
    pending -= lines * lineHeight();
    scroll(lines > 0 ? "up" : "down", Math.abs(lines));
  };
  const add = (px: number) => {
    pending += px;
    if (!raf) raf = requestAnimationFrame(flush);
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const unit = e.deltaMode === 1 ? lineHeight() : e.deltaMode === 2 ? el.clientHeight : 1;
    add(-e.deltaY * unit);
  };

  // Touch: drag down = older output, with a short momentum glide after release.
  let lastY = 0;
  let lastT = 0;
  let velocity = 0; // px per ms
  let dragging = false;
  let startY = 0;
  let glide = 0;
  const onStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    cancelAnimationFrame(glide);
    startY = lastY = e.touches[0]!.clientY;
    lastT = e.timeStamp;
    velocity = 0;
    dragging = false;
  };
  const onMove = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    const y = e.touches[0]!.clientY;
    if (!dragging && Math.abs(y - startY) < 6) return; // still a tap
    dragging = true;
    e.preventDefault();
    e.stopPropagation();
    const dt = Math.max(1, e.timeStamp - lastT);
    velocity = (y - lastY) / dt;
    add(y - lastY);
    lastY = y;
    lastT = e.timeStamp;
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    let v = velocity;
    let prev = performance.now();
    const step = (now: number) => {
      const dt = now - prev;
      prev = now;
      v *= Math.pow(0.95, dt / 16);
      if (Math.abs(v) < 0.05) return;
      add(v * dt);
      glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  };

  const opts = { capture: true, passive: false } as const;
  el.addEventListener("wheel", onWheel, opts);
  el.addEventListener("touchstart", onStart, { capture: true, passive: true });
  el.addEventListener("touchmove", onMove, opts);
  el.addEventListener("touchend", onEnd, { capture: true });
  return () => {
    cancelAnimationFrame(raf);
    cancelAnimationFrame(glide);
    el.removeEventListener("wheel", onWheel, opts);
    el.removeEventListener("touchstart", onStart, { capture: true });
    el.removeEventListener("touchmove", onMove, opts);
    el.removeEventListener("touchend", onEnd, { capture: true });
  };
}

export function TerminalView({ name, active, className }: { name: string; active: boolean; className?: string }) {
  const isTouch = useIsTouch();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ctrlRef = useRef(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [attempt, setAttempt] = useState(0);
  const [showKeys, setShowKeys] = useState(isTouch);
  const [showComposer, setShowComposer] = useState(isTouch);
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const [draft, setDraft] = useState("");
  const [withEnter, setWithEnter] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [copyView, setCopyView] = useState(false);

  const sendFrame = (type: number, data: string) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    const bytes = enc.encode(data);
    const frame = new Uint8Array(bytes.length + 1);
    frame[0] = type;
    frame.set(bytes, 1);
    ws.send(frame);
  };
  const send = (data: string) => sendFrame(MSG_INPUT, data);
  const sendScroll = (dir: "up" | "down" | "exit", lines = 1) =>
    sendFrame(MSG_SCROLL, JSON.stringify({ dir, lines }));

  const armCtrl = (on: boolean) => {
    ctrlRef.current = on;
    setCtrlArmed(on);
  };

  const fit = () => {
    const term = termRef.current;
    const fitAddon = fitRef.current;
    if (!term || !fitAddon || !hostRef.current?.offsetWidth) return;
    fitAddon.fit();
    sendFrame(MSG_RESIZE, JSON.stringify({ cols: term.cols, rows: term.rows }));
  };

  const sendDraft = () => {
    const text = draft.replace(/\r\n/g, "\n");
    if (!text && !withEnter) return;
    // Multi-line text goes in as a bracketed paste so Claude/bash don't submit at the first newline.
    if (text) send(text.includes("\n") ? `\x1b[200~${text}\x1b[201~` : text);
    if (withEnter) setTimeout(() => send("\r"), text ? 60 : 0);
    setDraft("");
    composerRef.current?.focus();
  };

  // Create the terminal once per session.
  useEffect(() => {
    const narrow = window.innerWidth < 640;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
      fontSize: narrow ? 12 : 13.5,
      lineHeight: narrow ? 1.1 : 1.2,
      scrollback: 5000,
      allowProposedApi: true,
      theme: {
        background: "#0c0c0e",
        foreground: "#e4e4e7",
        cursor: "#e8875a",
        selectionBackground: "#e8875a55",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current!);
    // WebGL only on desktop: on phones it rendered a blank canvas at high pixel ratios and mobile
    // browsers drop GL contexts aggressively; the DOM renderer is plenty fast there.
    if (!window.matchMedia("(pointer: coarse)").matches) {
      import("@xterm/addon-webgl")
        .then(({ WebglAddon }) => {
          const gl = new WebglAddon();
          gl.onContextLoss(() => gl.dispose());
          term.loadAddon(gl);
        })
        .catch(() => {});
    }
    termRef.current = term;
    fitRef.current = fitAddon;
    // Ctrl+Shift+C (or Cmd+C) copies the selection; plain Ctrl+C still reaches the program as ^C.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown" || !term.hasSelection()) return true;
      const k = e.key.toLowerCase();
      if ((k === "c" && e.ctrlKey && e.shiftKey) || (k === "c" && e.metaKey)) {
        e.preventDefault();
        copyWithToast(term.getSelection());
        return false;
      }
      return true;
    });
    const onSel = term.onSelectionChange(() => setHasSelection(term.hasSelection()));
    // OSC 52 from programs (tmux forwards it with set-clipboard on): put it on the browser clipboard.
    const osc = term.parser.registerOscHandler(52, (data) => {
      const text = osc52Text(data);
      if (text) copyWithToast(text, "Copied from terminal");
      return true;
    });
    const onData = term.onData((d) => {
      if (ctrlRef.current) {
        const c = ctrlOf(d);
        armCtrl(false);
        if (c !== null) return send(c);
      }
      send(d);
    });
    const ro = new ResizeObserver(() => requestAnimationFrame(fit));
    ro.observe(hostRef.current!);
    const stopScroll = attachScrolling(hostRef.current!, term, (dir, lines) => sendScroll(dir, lines));
    return () => {
      stopScroll();
      ro.disconnect();
      onSel.dispose();
      osc.dispose();
      onData.dispose();
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // (Re)connect the WebSocket.
  useEffect(() => {
    const term = termRef.current!;
    fitRef.current?.fit();
    setStatus("connecting");
    const ws = new WebSocket(wsUrl(`/ws/term/${name}?cols=${term.cols}&rows=${term.rows}`));
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    let retry: ReturnType<typeof setTimeout> | undefined;
    ws.onopen = () => {
      setStatus("open");
      term.reset();
      fit();
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        // Status frame from the server, e.g. {"scroll":true} while showing history.
        try {
          const msg = JSON.parse(e.data);
          if (typeof msg.scroll === "boolean") setScrolled(msg.scroll);
        } catch {}
        return;
      }
      term.write(new Uint8Array(e.data as ArrayBuffer));
    };
    ws.onclose = (e) => {
      if (wsRef.current !== ws) return;
      if (e.code === 4000 || e.code === 4404) {
        setStatus("ended");
        return;
      }
      setStatus("closed");
      // Network blip: retry with backoff, the tmux session keeps running meanwhile.
      retry = setTimeout(() => setAttempt((a) => a + 1), Math.min(10_000, 1000 * 2 ** Math.min(attempt, 4)));
    };
    return () => {
      clearTimeout(retry);
      wsRef.current = null;
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, attempt]);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      fit();
      // On touch devices focusing xterm pops the keyboard over the output; let the user tap instead.
      if (!isTouch) termRef.current?.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const pressKey = (k: Key) => {
    if (k.ctrl) return armCtrl(!ctrlRef.current);
    if (k.scroll) {
      const half = Math.max(1, Math.floor((termRef.current?.rows ?? 20) / 2));
      return sendScroll(k.scroll, half);
    }
    if (k.seq) send(k.seq);
    armCtrl(false);
  };

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col bg-terminal", className)}>
      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="absolute inset-0 touch-none overflow-hidden" />
        {hasSelection && (
          <Button
            size="sm"
            variant="secondary"
            className="absolute right-3 top-3 z-10 h-8 shadow-lg"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const term = termRef.current;
              if (!term) return;
              copyWithToast(term.getSelection());
              term.clearSelection();
              term.focus();
            }}
          >
            <Copy className="size-4" /> Copy
          </Button>
        )}
        {scrolled && (
          <Button
            size="sm"
            variant="secondary"
            className="absolute bottom-3 right-3 z-10 h-9 shadow-lg"
            onClick={() => sendScroll("exit")}
          >
            <ArrowDown className="size-4" /> Terbaru
          </Button>
        )}
      </div>
      {status !== "open" && (
        <div className="absolute right-3 top-3 flex items-center gap-2 rounded-md border bg-card/90 px-3 py-1.5 text-xs shadow">
          {status === "connecting" && <span className="text-muted-foreground">Connecting…</span>}
          {status === "closed" && <span className="text-warning">Disconnected, retrying…</span>}
          {status === "ended" && <span className="text-muted-foreground">Session not connected</span>}
          {status !== "connecting" && (
            <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setAttempt((a) => a + 1)}>
              <RotateCw className="size-3" /> Sambung
            </Button>
          )}
        </div>
      )}

      {copyView && <CopyView name={name} onClose={() => setCopyView(false)} />}

      {showComposer && (
        <form
          className="flex items-end gap-1.5 border-t bg-card px-2 py-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            sendDraft();
          }}
        >
          <textarea
            ref={composerRef}
            rows={1}
            value={draft}
            placeholder="Type a command or prompt…"
            enterKeyHint="send"
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              // Desktop: Enter sends, Shift+Enter = newline. Touch keyboards: Enter = newline, use the button.
              if (e.key === "Enter" && !e.shiftKey && !isTouch) {
                e.preventDefault();
                sendDraft();
              }
            }}
            className="max-h-40 min-h-10 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-base leading-snug outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
          />
          <Button
            type="button"
            size="icon"
            variant={withEnter ? "secondary" : "ghost"}
            className="size-10 shrink-0"
            title={withEnter ? "Send + Enter" : "Send without Enter"}
            onClick={() => setWithEnter((v) => !v)}
          >
            <CornerDownLeft className={cn("size-4", !withEnter && "opacity-40")} />
          </Button>
          <Button type="submit" size="icon" className="size-10 shrink-0" title="Send" disabled={status !== "open"}>
            <SendHorizontal className="size-4" />
          </Button>
        </form>
      )}

      <div className="pb-safe flex items-center gap-1 overflow-x-auto overscroll-x-contain border-t bg-card px-1.5 py-1 [scrollbar-width:none]">
        <Button
          size="icon"
          variant={showComposer ? "secondary" : "ghost"}
          className="size-9 shrink-0 sm:size-8"
          title="Input box"
          onClick={() => {
            setShowComposer((v) => !v);
            requestAnimationFrame(fit);
          }}
        >
          {showComposer ? <X className="size-4" /> : <PenLine className="size-4" />}
        </Button>
        <Button
          size="icon"
          variant={showKeys ? "secondary" : "ghost"}
          className="size-9 shrink-0 sm:size-8"
          title="Special keys"
          onClick={() => setShowKeys((v) => !v)}
        >
          <Keyboard className="size-4" />
        </Button>
        <Button
          size="icon"
          variant={copyView ? "secondary" : "ghost"}
          className="size-9 shrink-0 sm:size-8"
          title="Copy text from the terminal"
          onClick={() => setCopyView((v) => !v)}
        >
          <Copy className="size-4" />
        </Button>
        {showKeys ? (
          KEYS.map((k) => (
            <Button
              key={k.label}
              size="sm"
              variant={k.ctrl && ctrlArmed ? "default" : "outline"}
              title={k.title}
              className="h-9 min-w-9 shrink-0 px-2.5 font-mono text-xs sm:h-8"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pressKey(k)}
            >
              {k.scroll === "up" ? (
                <>
                  <ChevronsUp className="size-3.5" />
                  <span className="hidden min-[380px]:inline">history</span>
                </>
              ) : k.scroll === "down" ? (
                <ChevronsDown className="size-3.5" />
              ) : (
                k.label
              )}
            </Button>
          ))
        ) : (
          <span className="truncate text-[11px] text-muted-foreground">
            Scroll/drag for history · select with the mouse, then Ctrl+Shift+C · copy button for the full text
          </span>
        )}
      </div>
    </div>
  );
}
