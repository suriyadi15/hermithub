import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./paths";

const BIN_DIR = join(DATA_DIR, "bin");
const LOCAL_BIN = join(BIN_DIR, "cloudflared");
const RELEASE = "https://github.com/cloudflare/cloudflared/releases/latest/download";

function asset(): { name: string; tgz: boolean } {
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : null;
  if (!arch) throw new Error(`Unsupported CPU ${process.arch}. Install cloudflared yourself and put it on PATH.`);
  if (process.platform === "linux") return { name: `cloudflared-linux-${arch}`, tgz: false };
  if (process.platform === "darwin") return { name: `cloudflared-darwin-${arch}.tgz`, tgz: true };
  throw new Error(`Unsupported system ${process.platform}. Install cloudflared yourself and put it on PATH.`);
}

/** cloudflared from PATH, else the copy under DATA_DIR/bin (downloaded on first use). */
async function findCloudflared(): Promise<string> {
  const onPath = Bun.which("cloudflared");
  if (onPath) return onPath;
  if (existsSync(LOCAL_BIN)) return LOCAL_BIN;

  const { name, tgz } = asset();
  console.log(`Downloading cloudflared (${name}) ...`);
  const res = await fetch(`${RELEASE}/${name}`, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  mkdirSync(BIN_DIR, { recursive: true });
  const tmp = join(BIN_DIR, `${name}.part`);
  await Bun.write(tmp, res);
  if (tgz) {
    const proc = Bun.spawnSync(["tar", "-xzf", tmp, "-C", BIN_DIR, "cloudflared"]);
    rmSync(tmp, { force: true });
    if (proc.exitCode !== 0) throw new Error("Could not unpack cloudflared");
  } else {
    renameSync(tmp, LOCAL_BIN);
  }
  chmodSync(LOCAL_BIN, 0o755);
  return LOCAL_BIN;
}

/**
 * `hermithub tunnel`: publish the local dashboard on a random https://*.trycloudflare.com address
 * (Cloudflare quick tunnel, no account) until Ctrl+C. The address changes on every run.
 */
export async function tunnelCommand(args: string[]) {
  const portArg = args.indexOf("--port");
  const port = Number((portArg >= 0 ? args[portArg + 1] : process.env.PORT) || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("Invalid port.");
    process.exit(1);
  }

  let bin: string;
  try {
    bin = await findCloudflared();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }

  const proc = Bun.spawn([bin, "tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
    stdout: "ignore",
    stderr: "pipe",
  });
  process.on("SIGINT", () => proc.kill());
  process.on("SIGTERM", () => proc.kill());

  let shown = false;
  const decoder = new TextDecoder();
  for await (const chunk of proc.stderr) {
    const text = decoder.decode(chunk);
    const url = !shown && text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
    if (url) {
      shown = true;
      console.log(`
HermitHub is reachable at:

  ${url}

Make sure HermitHub itself is running on port ${port}, and protect it with a strong password
and two-factor authentication: anyone with this link can reach the login page.
For a correct client IP in the login lockout, set TRUST_PROXY=cloudflare and restart HermitHub.
The address changes every time; press Ctrl+C to close the tunnel.`);
    }
  }
  process.exit(await proc.exited);
}
