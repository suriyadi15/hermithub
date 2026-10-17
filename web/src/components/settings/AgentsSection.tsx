import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound, LogIn, LogOut, RefreshCw, SquareTerminal, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap, type Agent } from "@/lib/api";
import { useAgents, useTasks } from "@/lib/queries";

type Action = "install" | "update" | "uninstall" | "login" | "logout";
export type OpenTask = (name: string, hint?: string) => void;

function AgentCard({ agent, onTask }: { agent: Agent; onTask: OpenTask }) {
  const qc = useQueryClient();
  const tasks = useTasks();
  const running = tasks.data?.find((t) => t.task === `agent:${agent.id}` && t.status === "running");
  const [key, setKey] = useState("");
  const [confirmUninstall, setConfirmUninstall] = useState(false);

  const run = useMutation({
    mutationFn: (action: Action) => unwrap(api.agents({ id: agent.id }).task.post({ action })),
    onSuccess: (r, action) => {
      onTask(r.name, action === "login" ? agent.loginHint : undefined);
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => toast.error(e.message),
  });
  const save = useMutation({
    mutationFn: (body: { apiKey?: string | null; defaultPermission?: string }) => unwrap(api.agents({ id: agent.id }).put(body)),
    onSuccess: (_, body) => {
      if (body.apiKey !== undefined) {
        toast.success(body.apiKey ? "API key saved" : "API key removed");
        setKey("");
      } else toast.success("Default permission saved");
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const authed = agent.loggedIn || !!agent.apiKey?.hint;

  return (
    <div className="rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{agent.name}</h3>
            <a href={agent.homepage} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Docs">
              <ExternalLink className="size-3.5" />
            </a>
          </div>
          <p className="text-xs text-muted-foreground">
            {agent.vendor}
            {agent.installed && agent.version && <> · v{agent.version}</>}
          </p>
        </div>
        {!agent.installed ? (
          <Badge variant="outline">Not installed</Badge>
        ) : authed ? (
          <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
            {agent.loggedIn ? "Logged in" : "API key"}
          </Badge>
        ) : (
          <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">
            Not logged in
          </Badge>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {running ? (
          <Button size="sm" onClick={() => onTask(running.name)}>
            <SquareTerminal /> {running.label}…
          </Button>
        ) : !agent.installed ? (
          <Button size="sm" onClick={() => run.mutate("install")} disabled={run.isPending}>
            Install
          </Button>
        ) : (
          <>
            <Button size="sm" variant={authed ? "secondary" : "default"} onClick={() => run.mutate("login")} disabled={run.isPending}>
              <LogIn /> Log in
            </Button>
            <Button size="sm" variant="secondary" onClick={() => run.mutate("update")} disabled={run.isPending}>
              <RefreshCw /> Update
            </Button>
            {agent.loggedIn && (
              <Button size="sm" variant="ghost" onClick={() => run.mutate("logout")} disabled={run.isPending}>
                <LogOut /> Log out
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmUninstall(true)}>
              <Trash2 /> Uninstall
            </Button>
          </>
        )}
      </div>

      {agent.installed && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-1.5">
            <Label>Default permission mode</Label>
            <Select value={agent.defaultPermission} onValueChange={(v) => save.mutate({ defaultPermission: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {agent.permissionModes.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {agent.apiKey && (
            <form
              className="grid content-start gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate({ apiKey: key });
              }}
            >
              <Label htmlFor={`key-${agent.id}`}>
                {agent.apiKey.label} <span className="font-normal text-muted-foreground">(optional, instead of logging in)</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id={`key-${agent.id}`}
                  type="password"
                  autoComplete="off"
                  placeholder={agent.apiKey.hint ? `Saved ${agent.apiKey.hint}` : agent.apiKey.env}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
                {key ? (
                  <Button type="submit" variant="secondary" disabled={save.isPending}>
                    <KeyRound /> Save
                  </Button>
                ) : (
                  agent.apiKey.hint && (
                    <Button type="button" variant="ghost" onClick={() => save.mutate({ apiKey: null })}>
                      Remove
                    </Button>
                  )
                )}
              </div>
              <a href={agent.apiKey.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:underline">
                Get a key
              </a>
            </form>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmUninstall}
        onOpenChange={setConfirmUninstall}
        title={`Uninstall ${agent.name}?`}
        description="The program is removed. Its login and conversation history stay, so reinstalling picks up where you left off."
        confirmLabel="Uninstall"
        destructive
        onConfirm={() => run.mutate("uninstall")}
      />
    </div>
  );
}

export function AgentsSection({ onTask }: { onTask: OpenTask }) {
  const agents = useAgents();
  if (agents.isLoading) return <Skeleton className="h-32" />;
  return (
    <div className="grid gap-3">
      {agents.data?.map((a) => (
        <AgentCard key={a.id} agent={a} onTask={onTask} />
      ))}
    </div>
  );
}
