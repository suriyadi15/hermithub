import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError, unwrap } from "@/lib/api";

export default function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  /** Set once the server says the password was right and a second factor is needed. */
  const [needsCode, setNeedsCode] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <form
        className="w-full max-w-sm space-y-5 rounded-2xl border bg-card p-6 shadow-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError(null);
          try {
            await unwrap(api.auth.login.post({ password, code: needsCode ? code : undefined }));
            onLoggedIn();
          } catch (err) {
            const totp = err instanceof ApiError && (err.body as { totp?: boolean } | undefined)?.totp;
            if (totp && !needsCode) setNeedsCode(true);
            else setError((err as Error).message);
            if (totp) setCode("");
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-10" />
          <div>
            <h1 className="text-lg font-semibold">Project Hub</h1>
            <p className="text-sm text-muted-foreground">Projects and AI coding agents</p>
          </div>
        </div>
        {!needsCode ? (
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="code">{recovery ? "Recovery code" : "Authentication code"}</Label>
            <Input
              key={recovery ? "recovery" : "totp"}
              id="code"
              autoFocus
              {...(recovery
                ? { autoComplete: "off", placeholder: "xxxx-xxxx" }
                : { inputMode: "numeric" as const, autoComplete: "one-time-code", placeholder: "123456", maxLength: 6 })}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              {recovery ? "Each recovery code works once." : "Enter the 6-digit code from your authenticator app."}
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="button"
              className="justify-self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              onClick={() => {
                setRecovery(!recovery);
                setCode("");
                setError(null);
              }}
            >
              {recovery ? "Use the authenticator app" : "Use a recovery code"}
            </button>
          </div>
        )}
        <Button type="submit" className="w-full" disabled={(needsCode ? !code : !password) || pending}>
          {pending ? "Logging in…" : needsCode ? "Verify" : "Log in"}
        </Button>
      </form>
    </div>
  );
}
