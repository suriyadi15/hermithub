import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, unwrap } from "@/lib/api";

/** First run: no password exists yet. The setup token comes from the server logs (or the setup URL). */
export default function Setup({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState(() => new URLSearchParams(window.location.search).get("token") ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const hasUrlToken = new URLSearchParams(window.location.search).has("token");

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <form
        className="w-full max-w-sm space-y-5 rounded-2xl border bg-card p-6 shadow-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          if (password !== confirm) return setError("Passwords do not match");
          setPending(true);
          setError(null);
          try {
            await unwrap(api.auth.setup.post({ token, password }));
            window.history.replaceState(null, "", "/settings");
            onDone();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-10" />
          <div>
            <h1 className="text-lg font-semibold">Welcome to Project Hub</h1>
            <p className="text-sm text-muted-foreground">Create the password for this dashboard.</p>
          </div>
        </div>
        {!hasUrlToken && (
          <div className="grid gap-2">
            <Label htmlFor="token">Setup token</Label>
            <Input id="token" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Printed by the installer and in <code className="font-mono">docker compose logs project-hub</code>, and
              stored in <code className="font-mono">data/db/setup-token</code>.
            </p>
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="password">Password (min. 8 characters)</Label>
          <Input
            id="password"
            type="password"
            autoFocus
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm">Repeat password</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <Button type="submit" className="w-full" disabled={!token || password.length < 8 || pending}>
          {pending ? "Creating…" : "Create password"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Next, install an AI agent and connect GitHub from Settings.
        </p>
      </form>
    </div>
  );
}
