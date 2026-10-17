import { useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, unwrap } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { useTasks } from "@/lib/queries";
import { TerminalView } from "./TerminalView";

/**
 * Web terminal for a system task (agent install, login, GitHub login). Links and one-time codes the
 * task prints are repeated as buttons, since tapping a wrapped URL inside a terminal is unreliable.
 */
export function TaskSheet({ name, hint, onClose }: { name: string | null; hint?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const tasks = useTasks();
  const task = tasks.data?.find((t) => t.name === name);

  const close = async () => {
    onClose();
    if (task?.status === "exited") await unwrap(api.tasks({ name: task.name }).delete()).catch(() => {});
    for (const key of ["tasks", "agents", "github"]) qc.invalidateQueries({ queryKey: [key] });
  };

  return (
    <Sheet open={name !== null} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-3xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{task?.label ?? "Task"}</SheetTitle>
          <SheetDescription>
            {task?.status === "exited"
              ? task.exitStatus === 0
                ? "Finished."
                : `Failed (exit ${task.exitStatus ?? "?"}).`
              : (hint ?? "Running…")}
          </SheetDescription>
          {(task?.url || task?.code) && task.status === "running" && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {task.code && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="font-mono"
                  onClick={async () => toast.success((await copyText(task.code!)) ? "Code copied" : "Copy failed")}
                >
                  <Copy /> {task.code}
                </Button>
              )}
              {task.url && (
                <Button size="sm" asChild>
                  <a href={task.url} target="_blank" rel="noreferrer">
                    <ExternalLink /> Open sign-in page
                  </a>
                </Button>
              )}
            </div>
          )}
        </SheetHeader>
        {name && <TerminalView name={name} active className="min-h-0 flex-1" />}
        <div className="flex justify-end border-t p-3">
          <Button variant={task?.status === "exited" ? "default" : "ghost"} onClick={close}>
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
