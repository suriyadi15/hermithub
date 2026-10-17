import { existsSync } from "node:fs";
import { disableTotp, setPassword, totpEnabled } from "./auth";
import { autoUpdate, installUpdate, setAutoUpdate, updateStatus } from "./update";

/** Shared by `bun run set-password` and `project-hub set-password`. */
export async function setPasswordCommand(arg?: string) {
  const pw = arg ?? prompt("New password (min. 8 characters):");
  if (!pw) process.exit(1);
  await setPassword(pw);
  console.log("Password updated. All existing logins were signed out.");
}

/** Shared by `bun run disable-2fa` and `project-hub disable-2fa`. */
export function disable2faCommand() {
  if (!totpEnabled()) {
    console.log("Two-factor authentication is already off.");
    return;
  }
  disableTotp();
  console.log("Two-factor authentication turned off. Log in with the password alone, then set it up again in Settings.");
}

function usage(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function restartService(): string | null {
  const home = process.env.HOME ?? "";
  const unit = `${process.env.XDG_CONFIG_HOME || `${home}/.config`}/systemd/user/project-hub.service`;
  if (process.platform === "linux" && existsSync(unit)) {
    return Bun.spawnSync(["systemctl", "--user", "restart", "project-hub"]).exitCode === 0 ? "systemd" : null;
  }
  if (process.platform === "darwin" && existsSync(`${home}/Library/LaunchAgents/dev.project-hub.plist`)) {
    const uid = process.getuid?.() ?? 0;
    return Bun.spawnSync(["launchctl", "kickstart", "-k", `gui/${uid}/dev.project-hub`]).exitCode === 0 ? "launchd" : null;
  }
  return null;
}

/** `project-hub update [--check] [--version vX.Y.Z] [-y]` */
export async function updateCommand(args: string[]) {
  const check = args.includes("--check");
  const yes = args.includes("-y") || args.includes("--yes");
  const vi = args.indexOf("--version");
  const tag = vi >= 0 ? args[vi + 1] : undefined;
  if (vi >= 0 && !tag) usage("--version needs a tag, e.g. --version v0.5.0");

  const s = await updateStatus({ force: true });
  if (s.error) console.error(`Could not check for updates: ${s.error}`);
  console.log(`Installed: ${s.current}\nLatest:    ${s.latest ?? "unknown"}`);
  if (check) {
    console.log(s.available ? `\nUpdate available: run 'project-hub update'. Notes: ${s.notesUrl}` : "\nUp to date.");
    return;
  }
  if (!tag && !s.available) return console.log("\nUp to date.");
  if (s.kind === "docker") return console.log("\nDocker install: run 'docker compose pull && docker compose up -d'.");
  if (s.kind === "source") return console.log("\nRunning from source: run 'git pull && bun install && bun run build'.");
  const want = tag ?? s.latest!;
  if (!yes && !confirm(`\nInstall ${want}?`)) return;
  console.log(`Downloading ${want}...`);
  const r = await installUpdate({ tag: want }).catch((e: Error) => usage(`Update failed: ${e.message}`));
  console.log(`Installed ${r.to} (was ${r.from}).`);
  const restarted = restartService();
  console.log(
    restarted
      ? `Restarted the ${restarted} service. Agent sessions keep running.`
      : "Restart Project Hub to use the new version.",
  );
}

/** `project-hub auto-update on|off|status` */
export function autoUpdateCommand(arg?: string) {
  if (arg === "on" || arg === "off") setAutoUpdate(arg === "on");
  else if (arg && arg !== "status") usage("Usage: project-hub auto-update on|off|status");
  const a = autoUpdate();
  console.log(`Automatic updates are ${a.enabled ? "on" : "off"}${a.fromEnv ? " (set by HUB_AUTO_UPDATE)" : ""}.`);
  if (a.fromEnv && (arg === "on" || arg === "off")) {
    console.log("HUB_AUTO_UPDATE in the environment overrides this setting; change it in ~/.config/project-hub/env.");
  }
  if (arg === "on" || arg === "off") console.log("The running server picks this up at its next check (within 6 hours).");
}
