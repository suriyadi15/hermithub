import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/dialogs";
import { AgentsSection } from "@/components/settings/AgentsSection";
import { GitHubSection, GitIdentitySection, SshKeySection } from "@/components/settings/GitSections";
import { TwoFactorSection } from "@/components/settings/TwoFactorSection";
import { TaskSheet } from "@/components/TaskSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, unwrap } from "@/lib/api";
import { ago } from "@/lib/format";
import { useSettings } from "@/lib/queries";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const settings = useSettings();
  const trash = useQuery({ queryKey: ["trash"], queryFn: () => unwrap(api.projects.trash.list.get()) });
  const activity = useQuery({ queryKey: ["activity"], queryFn: () => unwrap(api.activity.get()), refetchInterval: 10_000 });
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [purgeId, setPurgeId] = useState<string | null>(null);
  const [task, setTask] = useState<{ name: string; hint?: string } | null>(null);
  const openTask = (name: string, hint?: string) => setTask({ name, hint });

  const changePw = useMutation({
    mutationFn: () => unwrap(api.auth.password.post({ current: pw.current, next: pw.next })),
    onSuccess: () => {
      toast.success("Password changed. Please log in again.");
      setTimeout(() => window.location.reload(), 800);
    },
    onError: (e) => toast.error(e.message),
  });
  const restore = useMutation({
    mutationFn: (id: string) => unwrap(api.projects.trash({ id }).restore.post({})),
    onSuccess: (r) => {
      toast.success(`"${r.name}" restored`);
      qc.invalidateQueries({ queryKey: ["trash"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e) => toast.error(e.message),
  });
  const purge = useMutation({
    mutationFn: (id: string) => unwrap(api.projects.trash({ id }).delete()),
    onSuccess: () => {
      toast.success("Deleted permanently");
      qc.invalidateQueries({ queryKey: ["trash"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="pb-safe mx-auto w-full max-w-3xl space-y-4 px-3 py-4 sm:space-y-5 sm:px-6 sm:py-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Section
        title="AI agents"
        description="Install and sign in to coding agents. They run inside the container; logins are kept across updates."
      >
        <AgentsSection onTask={openTask} />
      </Section>

      <Section title="GitHub" description="Clone private repositories and push from any session.">
        <GitHubSection onTask={openTask} />
      </Section>

      <Section title="Git identity" description="Name and email used for commits.">
        <GitIdentitySection />
      </Section>

      <Section title="SSH key" description="For git servers other than GitHub.">
        <SshKeySection />
      </Section>

      <Section title="Change password" description="Every logged-in device will be signed out.">
        <form
          className="grid gap-3 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (pw.next !== pw.confirm) return toast.error("The new passwords do not match");
            changePw.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="pw-current">Current password</Label>
            <Input id="pw-current" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pw-next">New password (min. 8 characters)</Label>
            <Input id="pw-next" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pw-confirm">Repeat new password</Label>
            <Input id="pw-confirm" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </div>
          <Button type="submit" className="h-10 sm:h-9 sm:justify-self-start" disabled={!pw.current || pw.next.length < 8 || changePw.isPending}>
            Change password
          </Button>
        </form>
      </Section>

      <Section title="Two-factor authentication" description="Ask for a code from an authenticator app after the password.">
        <TwoFactorSection />
      </Section>

      <Section title="Trash" description="Projects deleted from the dashboard.">
        {trash.data?.length ? (
          <ul className="divide-y rounded-lg border">
            {trash.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground">{ago(t.deletedAt)}</span>
                <Button size="sm" variant="secondary" className="h-9 sm:h-7" onClick={() => restore.mutate(t.id)}>
                  <RotateCcw /> Restore
                </Button>
                <Button size="sm" variant="ghost" className="h-9 text-destructive sm:h-7" aria-label="Delete permanently" onClick={() => setPurgeId(t.id)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Trash is empty.</p>
        )}
      </Section>

      <Section title="Recent activity">
        <ul className="max-h-80 space-y-1 overflow-auto text-sm">
          {activity.data?.map((a, i) => (
            <li key={i} className="grid grid-cols-[5.5rem_1fr] gap-x-3 sm:grid-cols-[7rem_auto_1fr]">
              <span className="text-xs text-muted-foreground">{ago(a.ts)}</span>
              <span className="font-mono text-xs">{a.action}</span>
              <span className="truncate text-xs text-muted-foreground max-sm:col-start-2">{a.detail}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="About">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="font-mono">{settings.data?.version}</dd>
          <dt className="text-muted-foreground">Projects folder</dt>
          <dd className="truncate font-mono">{settings.data?.projectsDir}</dd>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Update: run <code className="font-mono">docker compose pull && docker compose up -d</code> in the install folder. Running
          sessions are stopped; conversations can be continued afterwards.
        </p>
      </Section>

      <ConfirmDialog
        open={purgeId !== null}
        onOpenChange={(o) => !o && setPurgeId(null)}
        title="Delete permanently?"
        description="This folder will be deleted forever and cannot be restored."
        confirmLabel="Delete permanently"
        destructive
        onConfirm={() => purgeId && purge.mutate(purgeId)}
      />
      <TaskSheet name={task?.name ?? null} hint={task?.hint} onClose={() => setTask(null)} />
    </div>
  );
}
