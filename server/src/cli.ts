/**
 * Entry point of the standalone executable (`hermithub`). Commands are imported lazily so `version` and
 * `help` never touch the data folder.
 */
import pkg from "../../package.json";

const HELP = `HermitHub ${pkg.version}

Usage: hermithub [command]

  serve           Start the dashboard (default)
  set-password    Set a new login password (signs out every session)
  disable-2fa     Turn off two-factor authentication
  tunnel          Open a public https address for this dashboard via Cloudflare (no account; --port N)
  doctor          Check the tools HermitHub needs
  update          Install the latest release (--check: only check, --version vX.Y.Z, -y: no prompt)
  auto-update     Install new releases automatically: on, off or status
  version         Print the version

Settings come from the environment: PORT (8787), HOST (127.0.0.1), DATA_DIR (~/.hermithub),
PROJECTS_DIR (~/projects), PUBLIC_ORIGIN, TRUST_PROXY, HERMITHUB_AUTO_UPDATE. See docs/configuration.md.`;

async function doctor() {
  const { DATA_DIR, PROJECTS_DIR } = await import("./paths");
  const tools: [bin: string, required: boolean, why: string][] = [
    ["tmux", true, "runs agent sessions"],
    ["git", true, "git panel, clone, worktrees"],
    ["node", false, "npm-distributed agents (Codex, Gemini CLI, ...)"],
    ["npm", false, "installing npm-distributed agents"],
    ["gh", false, "GitHub login"],
  ];
  let ok = true;
  for (const [bin, required, why] of tools) {
    const path = Bun.which(bin);
    if (!path && required) ok = false;
    const mark = path ? "ok     " : required ? "MISSING" : "missing";
    console.log(`${mark}  ${bin.padEnd(5)} ${path ?? `(${why})`}`);
  }
  console.log(`\nData:     ${DATA_DIR}\nProjects: ${PROJECTS_DIR}`);
  if (!ok) process.exit(1);
}

const [command = "serve", ...args] = process.argv.slice(2);
// Installs from before the rename (Project Hub): move the data folder before anything opens it.
if (!["version", "--version", "-v", "help", "--help", "-h"].includes(command)) {
  (await import("./legacy")).migrateLegacyFiles();
}
switch (command) {
  case "serve": {
    const { migrateLegacyService } = await import("./legacy");
    const { supervised } = await import("./update");
    if (supervised()) migrateLegacyService();
    await (await import("./index")).start();
    break;
  }
  case "set-password":
    await (await import("./admin")).setPasswordCommand(args[0]);
    break;
  case "disable-2fa":
    (await import("./admin")).disable2faCommand();
    break;
  case "update":
    await (await import("./admin")).updateCommand(args);
    break;
  case "auto-update":
    (await import("./admin")).autoUpdateCommand(args[0]);
    break;
  case "tunnel":
    await (await import("./tunnel")).tunnelCommand(args);
    break;
  case "doctor":
    await doctor();
    break;
  case "version":
  case "--version":
  case "-v":
    console.log(process.env.HERMITHUB_VERSION || pkg.version);
    break;
  case "help":
  case "--help":
  case "-h":
    console.log(HELP);
    break;
  default:
    console.error(`Unknown command: ${command}\n\n${HELP}`);
    process.exit(1);
}
