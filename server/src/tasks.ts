import { Elysia } from "elysia";
import { logActivity } from "./db";
import { HttpError } from "./exec";
import { capture, findLoginHints, killSession, listSessions, newSession } from "./tmux";
import { HOME } from "./paths";

/**
 * System tasks: installs, updates and logins run as tmux sessions without a project, so their output
 * and interactive prompts show up in the same web terminal as project sessions.
 */
export async function runTask(opts: { task: string; label: string; script: string; env?: Record<string, string> }) {
  const sessions = await listSessions();
  const same = sessions.find((s) => s.task === opts.task);
  if (same && !same.dead) return { name: same.name };
  if (same) await killSession(same.name);

  const name = `hub-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  // Keep the pane (remain-on-exit) with a clear result line at the end.
  const script = `${opts.script}
code=$?
echo
if [ "$code" = 0 ]; then printf '\\033[32m✔ Done.\\033[0m You can close this window.\\n'; else printf '\\033[31m✘ Failed (exit %s).\\033[0m\\n' "$code"; fi
exit "$code"`;
  await newSession({
    name,
    cwd: HOME,
    // Not a login shell: /etc/profile would reset PATH, and the server's PATH already includes ~/.local/bin.
    command: ["bash", "-c", script],
    env: opts.env,
    options: { project: "", mode: "task", label: opts.label, task: opts.task, cmd: opts.script },
  });
  logActivity("task", opts.task);
  return { name };
}

export async function taskList() {
  const sessions = (await listSessions()).filter((s) => s.task);
  return Promise.all(
    sessions.map(async (s) => ({
      name: s.name,
      task: s.task,
      label: s.label,
      created: s.created,
      status: (s.dead ? "exited" : "running") as "exited" | "running",
      exitStatus: s.exitStatus,
      ...findLoginHints(await capture(s.name, 200)),
    })),
  );
}

export type TaskInfo = Awaited<ReturnType<typeof taskList>>[number];

export const taskRoutes = new Elysia({ prefix: "/api/tasks" })
  .get("/", () => taskList())
  .delete("/:name", async ({ params }) => {
    const s = (await listSessions()).find((x) => x.name === params.name && x.task);
    if (!s) throw new HttpError(404, "Task not found");
    await killSession(s.name);
    return { ok: true };
  });
