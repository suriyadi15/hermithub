import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type LegacyEnv, migrateLegacyFiles, migrateLegacyService } from "../src/legacy";

/** A home folder with a standalone install from before the rename, as install.sh v0.5.0 wrote it. */
function legacyHome(platform: NodeJS.Platform = "linux") {
  const home = mkdtempSync(join(tmpdir(), "hub-legacy-"));
  const config = join(home, ".config");
  const bin = join(home, ".local/bin/project-hub");
  mkdirSync(join(home, ".local/bin"), { recursive: true });
  writeFileSync(bin, "#!/bin/sh\necho 0.6.0\n", { mode: 0o755 });
  mkdirSync(join(home, ".project-hub"));
  writeFileSync(join(home, ".project-hub/hub.db"), "db");
  mkdirSync(join(config, "project-hub"), { recursive: true });
  writeFileSync(
    join(config, "project-hub/env"),
    `# Project Hub settings (standalone install).\nPORT=8787\n# DATA_DIR=${home}/.project-hub\n`,
  );
  writeFileSync(
    join(config, "project-hub/run.sh"),
    `#!/bin/sh\n. "${config}/project-hub/env"\nexec "${bin}" serve\n`,
  );
  mkdirSync(join(config, "systemd/user"), { recursive: true });
  writeFileSync(
    join(config, "systemd/user/project-hub.service"),
    `[Unit]\nDescription=Project Hub\n\n[Service]\nExecStart=${config}/project-hub/run.sh\n`,
  );
  mkdirSync(join(home, "Library/LaunchAgents"), { recursive: true });
  writeFileSync(
    join(home, "Library/LaunchAgents/dev.project-hub.plist"),
    `<string>dev.project-hub</string><string>${config}/project-hub/run.sh</string><string>${home}/Library/Logs/project-hub.log</string>`,
  );
  const calls: string[][] = [];
  const env: LegacyEnv = {
    home,
    configHome: config,
    execPath: bin,
    platform,
    uid: 501,
    run: (cmd) => (calls.push(cmd), true),
    detach: (cmd) => (calls.push(cmd), true),
    log: () => {},
  };
  return { home, config, bin, env, calls };
}

describe("migrateLegacyFiles", () => {
  test("moves the data and settings folders and leaves symlinks", () => {
    const { home, config, env } = legacyHome();
    migrateLegacyFiles(env, false);
    expect(readFileSync(join(home, ".hermithub/hub.db"), "utf8")).toBe("db");
    expect(readlinkSync(join(home, ".project-hub"))).toBe(join(home, ".hermithub"));
    expect(existsSync(join(config, "hermithub/env"))).toBe(true);
    expect(lstatSync(join(config, "project-hub")).isSymbolicLink()).toBe(true);
    // Running again changes nothing.
    migrateLegacyFiles(env, false);
    expect(readFileSync(join(home, ".project-hub/hub.db"), "utf8")).toBe("db");
  });

  test("keeps a DATA_DIR set in the environment", () => {
    const { home, env } = legacyHome();
    migrateLegacyFiles(env, true);
    expect(existsSync(join(home, ".hermithub"))).toBe(false);
    expect(lstatSync(join(home, ".project-hub")).isDirectory()).toBe(true);
  });

  test("never overwrites an existing new folder", () => {
    const { home, env } = legacyHome();
    mkdirSync(join(home, ".hermithub"));
    migrateLegacyFiles(env, false);
    expect(existsSync(join(home, ".hermithub/hub.db"))).toBe(false);
    expect(lstatSync(join(home, ".project-hub")).isDirectory()).toBe(true);
  });
});

describe("migrateLegacyService", () => {
  test("systemd: new unit, executable and start script, then hands over", () => {
    const { home, config, bin, env, calls } = legacyHome("linux");
    migrateLegacyFiles(env, false);
    expect(migrateLegacyService(env)).toBe(true);

    expect(readFileSync(join(home, ".local/bin/hermithub"), "utf8")).toContain("0.6.0");
    expect(readlinkSync(bin)).toBe("hermithub");
    const unit = readFileSync(join(config, "systemd/user/hermithub.service"), "utf8");
    expect(unit).toContain("Description=HermitHub");
    expect(unit).toContain(`ExecStart=${config}/hermithub/run.sh`);
    const run = readFileSync(join(config, "hermithub/run.sh"), "utf8");
    expect(run).toContain(`. "${config}/hermithub/env"`);
    expect(run).toContain(`exec "${home}/.local/bin/hermithub" serve`);
    expect(readFileSync(join(config, "hermithub/env"), "utf8")).toContain(`# DATA_DIR=${home}/.hermithub\n`);

    expect(calls.slice(0, 3)).toEqual([
      ["systemctl", "--user", "daemon-reload"],
      ["systemctl", "--user", "enable", "hermithub"],
      ["systemctl", "--user", "disable", "project-hub"],
    ]);
    const handover = calls[3]!;
    expect(handover.slice(0, 4)).toEqual(["systemd-run", "--user", "--collect", "--quiet"]);
    expect(handover.at(-1)).toContain("systemctl --user stop project-hub");
    expect(handover.at(-1)).toContain("systemctl --user start hermithub");

    // Once moved, the next start does nothing.
    expect(migrateLegacyService(env)).toBe(false);
  });

  test("launchd: new agent, then a detached handover", () => {
    const { home, config, env, calls } = legacyHome("darwin");
    migrateLegacyFiles(env, false);
    expect(migrateLegacyService(env)).toBe(true);
    const plist = readFileSync(join(home, "Library/LaunchAgents/dev.hermithub.plist"), "utf8");
    expect(plist).toBe(
      `<string>dev.hermithub</string><string>${config}/hermithub/run.sh</string><string>${home}/Library/Logs/hermithub.log</string>`,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.at(-1)).toContain("launchctl bootout gui/501/dev.project-hub");
    expect(calls[0]!.at(-1)).toContain(`launchctl bootstrap gui/501 '${home}/Library/LaunchAgents/dev.hermithub.plist'`);
  });

  test("does nothing without an old service", () => {
    const { config, env, calls } = legacyHome("linux");
    writeFileSync(join(config, "systemd/user/hermithub.service"), "");
    expect(migrateLegacyService(env)).toBe(false);
    expect(calls).toEqual([]);
  });
});
