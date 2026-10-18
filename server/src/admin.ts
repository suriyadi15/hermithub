import { existsSync } from "node:fs";
import { disableTotp, setPassword, totpEnabled } from "./auth";
import { LEGACY, NAME } from "./legacy";
import { autoUpdate, installUpdate, setAutoUpdate, updateStatus } from "./update";

/** Shared by `bun run set-password` and `hermithub set-password`. */
export async function setPasswordCommand(arg?: string) {
  const pw = arg ?? prompt("New password (min. 8 characters):");
  if (!pw) process.exit(1);
  await setPassword(pw);
  console.log("Password updated. All existing logins were signed out.");
}

/** Shared by `bun run disable-2fa` and `hermithub disable-2fa`. */
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

/** Restarts the service, under its new name or the one from before the rename (Project Hub). */
function restartService(): string | null {
  const home = process.env.HOME ?? "";
  const units = `${process.env.XDG_CONFIG_HOME || `${home}/.config`}/systemd/user`;
  for (const name of [NAME, LEGACY]) {
    if (process.platform === "linux" && existsSync(`${units}/${name}.service`)) {
      return Bun.spawnSync(["systemctl", "--user", "restart", name]).exitCode === 0 ? "systemd" : null;
    }
    if (process.platform === "darwin" && existsSync(`${home}/Library/LaunchAgents/dev.${name}.plist`)) {
      const uid = process.getuid?.() ?? 0;
      return Bun.spawnSync(["launchctl", "kickstart", "-k", `gui/${uid}/dev.${name}`]).exitCode === 0 ? "launchd" : null;
    }
  }
  return null;
}

/** `hermithub update [--check] [--version vX.Y.Z] [-y]` */
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
    console.log(s.available ? `\nUpdate available: run 'hermithub update'. Notes: ${s.notesUrl}` : "\nUp to date.");
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
      : "Restart HermitHub to use the new version.",
  );
}

/** `hermithub auto-update on|off|status` */
export function autoUpdateCommand(arg?: string) {
  if (arg === "on" || arg === "off") setAutoUpdate(arg === "on");
  else if (arg && arg !== "status") usage("Usage: hermithub auto-update on|off|status");
  const a = autoUpdate();
  console.log(`Automatic updates are ${a.enabled ? "on" : "off"}${a.fromEnv ? " (set by HERMITHUB_AUTO_UPDATE)" : ""}.`);
  if (a.fromEnv && (arg === "on" || arg === "off")) {
    console.log("HERMITHUB_AUTO_UPDATE in the environment overrides this setting; change it in ~/.config/hermithub/env.");
  }
  if (arg === "on" || arg === "off") console.log("The running server picks this up at its next check (within 6 hours).");
}
