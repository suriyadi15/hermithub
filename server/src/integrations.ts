import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Elysia, t } from "elysia";
import { logActivity } from "./db";
import { exec, HttpError } from "./exec";
import { HOME } from "./paths";
import { runTask } from "./tasks";

const SSH_KEY = join(HOME, ".ssh", "id_ed25519");

async function githubStatus() {
  if (!Bun.which("gh")) return { available: false, loggedIn: false, user: null as string | null };
  const r = await exec(["gh", "auth", "status", "--hostname", "github.com"], { timeoutMs: 15_000 });
  const out = r.stdout + r.stderr;
  const user = out.match(/account (\S+)/)?.[1] ?? out.match(/Logged in to github\.com as (\S+)/)?.[1] ?? null;
  return { available: true, loggedIn: r.code === 0, user };
}

async function gitConfig(key: string) {
  const r = await exec(["git", "config", "--global", "--get", key]);
  return r.code === 0 ? r.stdout.trim() : "";
}

export const integrationRoutes = new Elysia({ prefix: "/api/integrations" })
  .get("/github", () => githubStatus())
  /** Device-flow login in a web terminal; `gh auth setup-git` makes git use it for HTTPS. */
  .post("/github/login", () =>
    runTask({
      task: "github",
      label: "Log in to GitHub",
      script: "gh auth login --hostname github.com --git-protocol https --web && gh auth setup-git",
      // No browser in the container: gh then just prints the device-login URL.
      env: { BROWSER: "echo" },
    }),
  )
  .post(
    "/github/token",
    async ({ body }) => {
      const login = await exec(["gh", "auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--with-token"], {
        stdin: body.token.trim(),
        timeoutMs: 30_000,
      });
      if (login.code !== 0) throw new HttpError(400, login.stderr.trim() || "GitHub rejected the token");
      await exec(["gh", "auth", "setup-git"]);
      logActivity("github_login");
      return githubStatus();
    },
    { body: t.Object({ token: t.String({ minLength: 1, maxLength: 512 }) }) },
  )
  .post("/github/logout", async () => {
    const r = await exec(["gh", "auth", "logout", "--hostname", "github.com"], { timeoutMs: 15_000 });
    if (r.code !== 0) throw new HttpError(400, r.stderr.trim() || "Logout failed");
    logActivity("github_logout");
    return githubStatus();
  })
  .get("/git", async () => ({ name: await gitConfig("user.name"), email: await gitConfig("user.email") }))
  .put(
    "/git",
    async ({ body }) => {
      for (const [key, value] of [
        ["user.name", body.name.trim()],
        ["user.email", body.email.trim()],
      ] as const) {
        const r = value
          ? await exec(["git", "config", "--global", key, value])
          : await exec(["git", "config", "--global", "--unset", key]);
        // Exit code 5 = unsetting a key that is not set.
        if (r.code !== 0 && r.code !== 5) throw new HttpError(500, r.stderr.trim() || `git config ${key} failed`);
      }
      return { name: await gitConfig("user.name"), email: await gitConfig("user.email") };
    },
    { body: t.Object({ name: t.String({ maxLength: 200 }), email: t.String({ maxLength: 200 }) }) },
  )
  .get("/ssh", async () => ({
    publicKey: existsSync(SSH_KEY + ".pub") ? (await readFile(SSH_KEY + ".pub", "utf8")).trim() : null,
  }))
  .post("/ssh", async () => {
    if (existsSync(SSH_KEY)) throw new HttpError(409, "An SSH key already exists");
    await mkdir(join(HOME, ".ssh"), { recursive: true, mode: 0o700 });
    const r = await exec(["ssh-keygen", "-t", "ed25519", "-N", "", "-C", "hermithub", "-f", SSH_KEY]);
    if (r.code !== 0) throw new HttpError(500, r.stderr.trim() || "ssh-keygen failed");
    logActivity("ssh_key_created");
    return { publicKey: (await readFile(SSH_KEY + ".pub", "utf8")).trim() };
  });
