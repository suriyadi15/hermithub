import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, GitBranch, KeyRound, LogOut, SquareTerminal } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, unwrap } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { useTasks } from "@/lib/queries";
import type { OpenTask } from "./AgentsSection";

export function GitHubSection({ onTask }: { onTask: OpenTask }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["github"], queryFn: () => unwrap(api.integrations.github.get()) });
  const tasks = useTasks();
  const running = tasks.data?.find((t) => t.task === "github" && t.status === "running");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["github"] });
  const login = useMutation({
    mutationFn: () => unwrap(api.integrations.github.login.post()),
    onSuccess: (r) => onTask(r.name, "Press Enter when asked, then enter the code on github.com."),
    onError: (e) => toast.error(e.message),
  });
  const withToken = useMutation({
    mutationFn: () => unwrap(api.integrations.github.token.post({ token })),
    onSuccess: () => {
      toast.success("Connected to GitHub");
      setToken("");
      setShowToken(false);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const logout = useMutation({
    mutationFn: () => unwrap(api.integrations.github.logout.post()),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });

  const s = status.data;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <GitBranch className="size-5" />
        {s?.loggedIn ? (
          <>
            <span className="text-sm">
              Connected as <span className="font-medium">{s.user ?? "unknown"}</span>
            </span>
            <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
              Connected
            </Badge>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => logout.mutate()} disabled={logout.isPending}>
              <LogOut /> Log out
            </Button>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{status.isLoading ? "Checking…" : "Not connected"}</span>
        )}
      </div>
      {!s?.loggedIn && (
        <div className="flex flex-wrap gap-2">
          {running ? (
            <Button size="sm" onClick={() => onTask(running.name)}>
              <SquareTerminal /> Continue login…
            </Button>
          ) : (
            <Button size="sm" onClick={() => login.mutate()} disabled={login.isPending}>
              <GitBranch /> Log in with GitHub
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setShowToken((v) => !v)}>
            <KeyRound /> Use a token
          </Button>
        </div>
      )}
      {showToken && !s?.loggedIn && (
        <form
          className="grid gap-1.5 sm:max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            withToken.mutate();
          }}
        >
          <Label htmlFor="gh-token">Personal access token</Label>
          <div className="flex gap-2">
            <Input id="gh-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={!token || withToken.isPending}>
              Connect
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Needs the <code>repo</code>, <code>read:org</code> and <code>workflow</code> scopes.{" "}
            <a
              href="https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=Project%20Hub"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Create one
            </a>
          </p>
        </form>
      )}
      <p className="text-xs text-muted-foreground">
        Used by git (clone, pull, push over HTTPS) and the <code>gh</code> CLI in every session.
      </p>
    </div>
  );
}

export function GitIdentitySection() {
  const qc = useQueryClient();
  const git = useQuery({ queryKey: ["git-identity"], queryFn: () => unwrap(api.integrations.git.get()) });
  const [form, setForm] = useState({ name: "", email: "" });
  useEffect(() => {
    if (git.data) setForm(git.data);
  }, [git.data]);
  const save = useMutation({
    mutationFn: () => unwrap(api.integrations.git.put(form)),
    onSuccess: (r) => {
      toast.success("Git identity saved");
      qc.setQueryData(["git-identity"], r);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="git-name">Name</Label>
        <Input id="git-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="git-email">Email</Label>
        <Input id="git-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </div>
      <Button
        type="submit"
        variant="secondary"
        disabled={save.isPending || (form.name === git.data?.name && form.email === git.data?.email)}
      >
        Save
      </Button>
    </form>
  );
}

export function SshKeySection() {
  const qc = useQueryClient();
  const ssh = useQuery({ queryKey: ["ssh"], queryFn: () => unwrap(api.integrations.ssh.get()) });
  const create = useMutation({
    mutationFn: () => unwrap(api.integrations.ssh.post()),
    onSuccess: (r) => qc.setQueryData(["ssh"], r),
    onError: (e) => toast.error(e.message),
  });
  const key = ssh.data?.publicKey;
  return key ? (
    <div className="grid gap-2">
      <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-all">{key}</pre>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={async () => toast.success((await copyText(key)) ? "Copied" : "Copy failed")}>
          <Copy /> Copy public key
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Add it as an SSH key on GitLab, Bitbucket or your own git server. GitHub works without it once connected above.
      </p>
    </div>
  ) : (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">No SSH key yet.</p>
      <Button size="sm" variant="secondary" className="justify-self-start" onClick={() => create.mutate()} disabled={create.isPending}>
        <KeyRound /> Generate SSH key
      </Button>
    </div>
  );
}
