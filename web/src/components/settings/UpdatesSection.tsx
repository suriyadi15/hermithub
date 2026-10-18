import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api, unwrap } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { ago } from "@/lib/format";
import { useUpdateStatus } from "@/lib/queries";

const COMMANDS = {
  docker: "docker compose pull && docker compose up -d",
  source: "git pull && bun install && bun run build",
};

/** Waits for the restarted server to report a version other than `from`, then reloads the page. */
async function reloadWhenUpdated(from: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const res = await fetch("/api/settings", { credentials: "same-origin" });
      if (res.ok && (await res.json()).version !== from) return window.location.reload();
    } catch {}
  }
  toast.error("HermitHub did not come back. Check the service logs.");
}

export function UpdatesSection() {
  const qc = useQueryClient();
  const status = useUpdateStatus();
  const [confirm, setConfirm] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const s = status.data;

  const check = useMutation({
    mutationFn: () => unwrap(api.update.get({ query: { force: "1" } })),
    onSuccess: (r) => {
      qc.setQueryData(["update"], r);
      if (r.error) toast.error(r.error);
      else toast.success(r.available ? `${r.latest} is available` : "HermitHub is up to date");
    },
    onError: (e) => toast.error(e.message),
  });
  const install = useMutation({
    mutationFn: () => unwrap(api.update.install.post({ version: s?.latest ?? undefined })),
    onSuccess: async (r) => {
      if (!r.restarting) {
        toast.success(`Installed ${r.to}. Restart HermitHub to use it.`);
        return;
      }
      toast.success(`Installed ${r.to}. Restarting… Agent sessions keep running.`);
      setWaiting(true);
      await reloadWhenUpdated(r.from);
      setWaiting(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const auto = useMutation({
    mutationFn: (enabled: boolean) => unwrap(api.update.auto.put({ enabled })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["update"] }),
    onError: (e) => toast.error(e.message),
  });

  if (!s) return <p className="text-sm text-muted-foreground">{status.error ? status.error.message : "Checking…"}</p>;
  const busy = install.isPending || waiting || s.installing;

  return (
    <div className="grid gap-4">
      <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
        <dt className="text-muted-foreground">Installed</dt>
        <dd className="font-mono">{s.current}</dd>
        <dt className="text-muted-foreground">Latest</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{s.latest ?? "unknown"}</span>
          {s.available && <Badge>New</Badge>}
          {s.notesUrl && (
            <a href={s.notesUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Release notes <ExternalLink className="size-3" />
            </a>
          )}
        </dd>
        <dt className="text-muted-foreground">Checked</dt>
        <dd className="text-muted-foreground">
          {ago(s.checkedAt)}
          {s.error && <span className="text-destructive"> · {s.error}</span>}
        </dd>
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" className="h-9 sm:h-8" disabled={check.isPending} onClick={() => check.mutate()}>
          <RefreshCw className={check.isPending ? "animate-spin" : undefined} /> Check now
        </Button>
        {s.canInstall && s.available && (
          <Button size="sm" className="h-9 sm:h-8" disabled={busy} onClick={() => setConfirm(true)}>
            {busy ? <Loader2 className="animate-spin" /> : <ArrowUpCircle />}
            {waiting ? "Restarting…" : busy ? "Updating…" : `Update to ${s.latest}`}
          </Button>
        )}
      </div>

      {s.canInstall ? (
        <div className="grid gap-1">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={s.auto.enabled}
              disabled={s.auto.fromEnv || auto.isPending}
              onCheckedChange={(v) => auto.mutate(v === true)}
            />
            Install updates automatically
          </label>
          <p className="text-xs text-muted-foreground">
            {s.auto.fromEnv
              ? "Set by HERMITHUB_AUTO_UPDATE in the environment; change it in ~/.config/hermithub/env."
              : "Checked every 6 hours. The server restarts on its own; running agent sessions keep going."}{" "}
            From a terminal: <code className="font-mono">hermithub update</code>,{" "}
            <code className="font-mono">hermithub auto-update on|off</code>.
          </p>
        </div>
      ) : (
        <div className="grid gap-1.5 text-xs text-muted-foreground">
          <p>
            {s.kind === "docker"
              ? "Update from the install folder (running sessions are stopped; conversations can be continued afterwards):"
              : "Running from source. Update with:"}
          </p>
          <div className="flex items-center gap-1">
            <code className="min-w-0 truncate rounded bg-muted px-2 py-1 font-mono">{COMMANDS[s.kind as keyof typeof COMMANDS]}</code>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="Copy command"
              onClick={async () => ((await copyText(COMMANDS[s.kind as keyof typeof COMMANDS])) ? toast.success("Copied") : toast.error("Copy failed"))}
            >
              <Copy />
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Update to ${s.latest}?`}
        description="HermitHub downloads the new version, checks its checksum and restarts. Running agent sessions keep going; this page reloads when it is back."
        confirmLabel="Update"
        onConfirm={() => install.mutate()}
      />
    </div>
  );
}
