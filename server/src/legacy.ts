import { chmodSync, copyFileSync, existsSync, lstatSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * HermitHub was called Project Hub up to v0.5.0. Those standalone installs auto-update to this executable under
 * their old names (~/.local/bin/project-hub, project-hub.service, ~/.project-hub, ~/.config/project-hub), so the
 * executable moves them over itself. install.sh does the same when it is run again. The old paths are left as
 * symlinks, so commands and scripts that use them keep working.
 */
export const LEGACY = "project-hub";
export const NAME = "hermithub";

export interface LegacyEnv {
  home: string;
  configHome: string;
  execPath: string;
  platform: NodeJS.Platform;
  uid: number;
  /** Runs a command; returns true when it succeeded. */
  run: (cmd: string[]) => boolean;
  /** Starts a command that outlives this process (it stops the old service, which ends this process). */
  detach: (cmd: string[]) => boolean;
  log: (msg: string) => void;
}

function defaultEnv(): LegacyEnv {
  const home = process.env.HOME ?? "/root";
  return {
    home,
    configHome: process.env.XDG_CONFIG_HOME || join(home, ".config"),
    execPath: process.execPath,
    platform: process.platform,
    uid: process.getuid?.() ?? 0,
    run: (cmd) => Bun.spawnSync(cmd, { stdout: "ignore", stderr: "ignore" }).exitCode === 0,
    detach: (cmd) => {
      try {
        Bun.spawn(cmd, { stdio: ["ignore", "ignore", "ignore"] }).unref();
        return true;
      } catch {
        return false;
      }
    },
    log: (msg) => console.log(msg),
  };
}

const isLink = (p: string) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/** Renames `from` to `to` and leaves a symlink behind, unless `to` exists already. */
function moveDir(from: string, to: string, log: LegacyEnv["log"]) {
  if (!existsSync(from) || isLink(from) || existsSync(to)) return;
  renameSync(from, to);
  symlinkSync(to, from);
  log(`Moved ${from} to ${to}`);
}

/**
 * Moves the data and settings folders. Runs before anything opens the database. A DATA_DIR set in the
 * environment is left alone.
 */
export function migrateLegacyFiles(env: LegacyEnv = defaultEnv(), dataDirSet = Boolean(process.env.DATA_DIR)) {
  try {
    if (!dataDirSet) moveDir(join(env.home, `.${LEGACY}`), join(env.home, `.${NAME}`), env.log);
    moveDir(join(env.configHome, LEGACY), join(env.configHome, NAME), env.log);
  } catch (e) {
    env.log(`Could not move the old Project Hub folders: ${e instanceof Error ? e.message : e}`);
  }
}

const rename = (text: string) =>
  text
    .replaceAll("Project Hub", "HermitHub")
    .replaceAll(`/${LEGACY}/`, `/${NAME}/`)
    .replaceAll(`/bin/${LEGACY}"`, `/bin/${NAME}"`)
    .replaceAll(`dev.${LEGACY}`, `dev.${NAME}`)
    .replaceAll(`${LEGACY}.log`, `${NAME}.log`)
    .replaceAll(`.${LEGACY}\n`, `.${NAME}\n`);

/** Rewrites `path` with the new names; returns false when it does not exist. */
function rewrite(path: string, to = path) {
  if (!existsSync(path)) return false;
  writeFileSync(to, rename(readFileSync(path, "utf8")));
  return true;
}

/**
 * Moves an old project-hub service (systemd unit or launchd agent) to the new name and hands over to it.
 * Returns true when the handover started: the old service stops this process shortly after.
 */
export function migrateLegacyService(env: LegacyEnv = defaultEnv()): boolean {
  const unitDir = join(env.configHome, "systemd/user");
  const oldUnit = join(unitDir, `${LEGACY}.service`);
  const newUnit = join(unitDir, `${NAME}.service`);
  const agents = join(env.home, "Library/LaunchAgents");
  const oldPlist = join(agents, `dev.${LEGACY}.plist`);
  const newPlist = join(agents, `dev.${NAME}.plist`);
  const linux = env.platform === "linux" && existsSync(oldUnit) && !existsSync(newUnit);
  const mac = env.platform === "darwin" && existsSync(oldPlist) && !existsSync(newPlist);
  if (!linux && !mac) return false;

  try {
    // The executable: copy it to the new name and leave a symlink at the old one.
    if (basename(env.execPath) === LEGACY) {
      const newBin = join(dirname(env.execPath), NAME);
      if (!existsSync(newBin)) {
        copyFileSync(env.execPath, newBin);
        chmodSync(newBin, 0o755);
      }
      const tmp = `${env.execPath}.link`;
      rmSync(tmp, { force: true });
      symlinkSync(NAME, tmp);
      renameSync(tmp, env.execPath);
    }
    // The start script and the env file (moved by migrateLegacyFiles) point at the new paths.
    const configDir = join(env.configHome, NAME);
    rewrite(join(configDir, "run.sh"));
    rewrite(join(configDir, "env"));

    if (linux) {
      rewrite(oldUnit, newUnit);
      env.run(["systemctl", "--user", "daemon-reload"]);
      env.run(["systemctl", "--user", "enable", NAME]);
      env.run(["systemctl", "--user", "disable", LEGACY]);
      const handover = [
        "sleep 2",
        `systemctl --user stop ${LEGACY}`,
        `rm -f '${oldUnit}'`,
        "systemctl --user daemon-reload",
        `systemctl --user start ${NAME}`,
      ].join("; ");
      if (env.run(["systemd-run", "--user", "--collect", "--quiet", "sh", "-c", handover])) {
        env.log(`Moving the ${LEGACY} service to ${NAME}.service`);
        return true;
      }
    } else {
      rewrite(oldPlist, newPlist);
      const domain = `gui/${env.uid}`;
      // The old agent sets AbandonProcessGroup, so this script survives the bootout that ends this process.
      const handover = [
        "sleep 2",
        `launchctl bootout ${domain}/dev.${LEGACY}`,
        `rm -f '${oldPlist}'`,
        `launchctl bootstrap ${domain} '${newPlist}'`,
      ].join("; ");
      if (env.detach(["/bin/sh", "-c", handover])) {
        env.log(`Moving the dev.${LEGACY} launchd agent to dev.${NAME}`);
        return true;
      }
    }
    env.log(`Could not move the ${LEGACY} service; run the installer again to finish the rename.`);
  } catch (e) {
    env.log(`Could not move the ${LEGACY} service: ${e instanceof Error ? e.message : e}`);
  }
  return false;
}
