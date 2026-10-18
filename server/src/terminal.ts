import { Elysia, t } from "elysia";
import { hasSession, parseScrollFrame, scroll, tmux, tmuxArgs } from "./tmux";

/**
 * Client → server frames are binary: first byte is the message type.
 *   0x00 + utf8 bytes  → keyboard input
 *   0x01 + utf8 JSON   → {"cols":n,"rows":n} resize
 *   0x02 + utf8 JSON   → {"dir":"up"|"down"|"exit","lines":n} scroll history (wheel/touch)
 * Server → client: binary frames are raw terminal output; text frames are JSON status
 * ({"scroll":boolean} = pane is in scroll/copy-mode).
 * Binary framing keeps Elysia from trying to JSON-parse pasted text.
 */
export const MSG_INPUT = 0;
export const MSG_RESIZE = 1;
export const MSG_SCROLL = 2;

type Attach = {
  name: string;
  proc: Bun.Subprocess;
  terminal: Bun.Terminal;
  /** Set while we put the pane in copy-mode, so typing first returns to the bottom. */
  inMode: boolean;
  send: (text: string) => void;
  /** Serialises scroll and input so a keystroke never races an in-flight scroll. */
  queue: Promise<unknown>;
};
const attached = new Map<string, Attach>();
/** Frames that arrive while `open` is still checking the session are replayed once attached. */
const pending = new Map<string, Uint8Array[]>();

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n) || min));
}

function handleFrame(a: Attach, buf: Uint8Array) {
  const payload = buf.subarray(1);
  if (buf[0] === MSG_INPUT) {
    const data = payload.slice();
    a.queue = a.queue.then(async () => {
      if (a.inMode) {
        a.inMode = false;
        await tmux("send-keys", "-t", `=${a.name}:`, "-X", "cancel");
        a.send(JSON.stringify({ scroll: false }));
      }
      a.terminal.write(data);
    });
  } else if (buf[0] === MSG_RESIZE) {
    try {
      const { cols, rows } = JSON.parse(new TextDecoder().decode(payload));
      a.terminal.resize(clamp(cols, 20, 500), clamp(rows, 5, 200));
    } catch {}
  } else if (buf[0] === MSG_SCROLL) {
    const req = parseScrollFrame(new TextDecoder().decode(payload));
    if (!req) return;
    a.queue = a.queue.then(async () => {
      a.inMode = await scroll(a.name, req.dir, req.lines).catch(() => false);
      a.send(JSON.stringify({ scroll: a.inMode }));
    });
  }
}

export const terminalRoutes = new Elysia().ws("/ws/term/:name", {
  query: t.Object({ cols: t.Optional(t.Numeric()), rows: t.Optional(t.Numeric()) }),
  async open(ws) {
    const { name } = ws.data.params;
    pending.set(ws.id, []);
    if (!/^hermithub-[a-z0-9]+$/.test(name) || !(await hasSession(name))) {
      pending.delete(ws.id);
      ws.close(4404, "session not found");
      return;
    }
    if (!pending.has(ws.id)) return; // closed while we were checking
    const cols = clamp(ws.data.query.cols ?? 120, 20, 500);
    const rows = clamp(ws.data.query.rows ?? 30, 5, 200);
    const proc = Bun.spawn(tmuxArgs("attach-session", "-t", `=${name}`), {
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols,
        rows,
        data(_term, data) {
          ws.send(data);
        },
      },
    });
    const a: Attach = {
      name,
      proc,
      terminal: proc.terminal!,
      inMode: false,
      send: (text) => ws.send(text),
      queue: Promise.resolve(),
    };
    attached.set(ws.id, a);
    for (const frame of pending.get(ws.id) ?? []) handleFrame(a, frame);
    pending.delete(ws.id);
    proc.exited.then(() => {
      if (attached.get(ws.id)?.proc === proc) {
        attached.delete(ws.id);
        ws.close(4000, "detached");
      }
    });
  },
  message(ws, message) {
    const buf =
      message instanceof Uint8Array
        ? message
        : message instanceof ArrayBuffer
          ? new Uint8Array(message)
          : null;
    if (!buf || buf.length === 0) return;
    const a = attached.get(ws.id);
    if (a) handleFrame(a, buf);
    else pending.get(ws.id)?.push(buf.slice());
  },
  close(ws) {
    const a = attached.get(ws.id);
    attached.delete(ws.id);
    pending.delete(ws.id);
    // Only the attach client is killed; the tmux session (and Claude) keeps running.
    a?.proc.kill();
  },
});
