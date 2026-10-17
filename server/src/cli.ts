/**
 * Entry point of the standalone executable (`project-hub`). Commands are imported lazily so `version` and
 * `help` never touch the data folder.
 */
import pkg from "../../package.json";

const HELP = `Project Hub ${pkg.version}

Usage: project-hub [command]

  serve           Start the dashboard (default)
  set-password    Set a new login password (signs out every session)
  disable-2fa     Turn off two-factor authentication
  doctor          Check the tools Project Hub needs
  version         Print the version

Settings come from the environment: PORT (8787), HOST (127.0.0.1), DATA_DIR (~/.project-hub),
PROJECTS_DIR (~/projects), PUBLIC_ORIGIN, TRUST_PROXY. See docs/configuration.md.`;

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
switch (command) {
  case "serve":
    await (await import("./index")).start();
    break;
  case "set-password":
    await (await import("./admin")).setPasswordCommand(args[0]);
    break;
  case "disable-2fa":
    (await import("./admin")).disable2faCommand();
    break;
  case "doctor":
    await doctor();
    break;
  case "version":
  case "--version":
  case "-v":
    console.log(process.env.HUB_VERSION || pkg.version);
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
