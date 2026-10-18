import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, ShieldCheck, ShieldOff } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, unwrap } from "@/lib/api";
import { copyText } from "@/lib/clipboard";

type Step =
  | { kind: "idle" }
  | { kind: "password" }
  | { kind: "scan"; secret: string; uri: string }
  | { kind: "manage"; action: "disable" | "recovery" };

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join("\n") + "\n";
  return (
    <div className="grid gap-3">
      <p className="text-sm">
        Save these recovery codes somewhere safe. Each one logs you in once if you lose your phone. They are not
        shown again.
      </p>
      <pre className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border bg-muted/50 p-3 font-mono text-sm sm:max-w-sm">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </pre>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={async () => ((await copyText(text)) ? toast.success("Copied") : toast.error("Copy failed"))}>
          <Copy /> Copy
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
            a.download = "hermithub-recovery-codes.txt";
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          <Download /> Download
        </Button>
        <Button size="sm" onClick={onDone}>
          I saved them
        </Button>
      </div>
    </div>
  );
}

export function TwoFactorSection() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => unwrap(api.auth.me.get()), staleTime: Infinity });
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  useEffect(() => {
    if (step.kind !== "scan") return setQr(null);
    QRCode.toDataURL(step.uri, { margin: 1, width: 192 }).then(setQr, () => setQr(null));
  }, [step]);

  const reset = () => {
    setStep({ kind: "idle" });
    setPassword("");
    setCode("");
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ["me"] });

  const setup = useMutation({
    mutationFn: () => unwrap(api.auth.totp.setup.post({ password })),
    onSuccess: (r) => {
      setPassword("");
      setStep({ kind: "scan", ...r });
    },
    onError: (e) => toast.error(e.message),
  });
  const enable = useMutation({
    mutationFn: () => unwrap(api.auth.totp.enable.post({ code })),
    onSuccess: (r) => {
      reset();
      setCodes(r.recoveryCodes);
      toast.success("Two-factor authentication is on. Other devices were signed out.");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const manage = useMutation({
    mutationFn: async (action: "disable" | "recovery") =>
      action === "disable"
        ? (await unwrap(api.auth.totp.disable.post({ password, code })), null)
        : (await unwrap(api.auth.totp.recovery.post({ password, code }))).recoveryCodes,
    onSuccess: (r) => {
      reset();
      if (r) setCodes(r);
      else toast.success("Two-factor authentication is off");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  if (codes) return <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />;

  const enabled = !!me.data?.totpEnabled;
  const codeInput = (
    <div className="grid gap-1.5">
      <Label htmlFor="totp-code">Code from the app</Label>
      <Input
        id="totp-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
    </div>
  );
  const passwordInput = (
    <div className="grid gap-1.5">
      <Label htmlFor="totp-password">Password</Label>
      <Input id="totp-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
    </div>
  );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {enabled ? <ShieldCheck className="size-5" /> : <ShieldOff className="size-5" />}
        {enabled ? (
          <>
            <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
              On
            </Badge>
            <span className="text-sm text-muted-foreground">{me.data?.recoveryLeft ?? 0} recovery codes left</span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">Off — logging in needs only the password</span>
        )}
      </div>

      {step.kind === "idle" &&
        (enabled ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setStep({ kind: "manage", action: "recovery" })}>
              New recovery codes
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStep({ kind: "manage", action: "disable" })}>
              Turn off
            </Button>
          </div>
        ) : (
          <Button size="sm" className="justify-self-start" onClick={() => setStep({ kind: "password" })}>
            <ShieldCheck /> Turn on
          </Button>
        ))}

      {step.kind === "password" && (
        <form
          className="grid gap-3 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            setup.mutate();
          }}
        >
          {passwordInput}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!password || setup.isPending}>
              Continue
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {step.kind === "scan" && (
        <form
          className="grid gap-3 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            enable.mutate();
          }}
        >
          <p className="text-sm">Scan this with an authenticator app (Google Authenticator, 1Password, Aegis…), then enter the code it shows.</p>
          {qr && <img src={qr} alt="QR code for the authenticator app" className="size-48 rounded-lg bg-white p-1" />}
          <p className="text-xs text-muted-foreground">
            Can't scan? Enter this key: <code className="break-all font-mono text-foreground">{step.secret}</code>
          </p>
          {codeInput}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={code.length < 6 || enable.isPending}>
              Turn on
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {step.kind === "manage" && (
        <form
          className="grid gap-3 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            manage.mutate(step.action);
          }}
        >
          {passwordInput}
          {codeInput}
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant={step.action === "disable" ? "destructive" : "default"} disabled={!password || !code || manage.isPending}>
              {step.action === "disable" ? "Turn off" : "Create new codes"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
