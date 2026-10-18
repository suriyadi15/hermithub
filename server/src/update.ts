import { existsSync } from "node:fs";
import { chmod, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Elysia, t } from "elysia";
import pkg from "../../package.json";
import { getSetting, logActivity, setSetting } from "./db";
import { exec, HttpError } from "./exec";

/**
 * Release checks and self-update of the standalone executable. The executable knows its release asset from
 * HERMITHUB_TARGET, set at build time (scripts/build-binaries.ts). Docker and source installs only get the check.
 */
export const VERSION: string = process.env.HERMITHUB_VERSION || pkg.version || "dev";
export const TARGET = process.env.HERMITHUB_TARGET ?? "";
const REPO = process.env.HERMITHUB_REPO || "suriyadi15/hermithub";
const API = (process.env.HERMITHUB_UPDATE_API || "https://api.github.com").replace(/\/$/, "");
const CHECK_EVERY_MS = 6 * 3600_000;

export type InstallKind = "binary" | "docker" | "source";
export const INSTALL_KIND: InstallKind = TARGET
  ? "binary"
  : process.env.HERMITHUB_DOCKER === "1" || existsSync("/.dockerenv")
    ? "docker"
    : "source";

/** -1, 0 or 1 for "v1.2.3" style versions; null when either is not a version (e.g. "dev"). */
export function cmpSemver(a: string, b: string): number | null {
  const parse = (v: string) => v.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d) return Math.sign(d);
  }
  // A pre-release sorts before its release.
  if (x[4] === y[4]) return 0;
  if (!x[4]) return 1;
  if (!y[4]) return -1;
  return x[4] < y[4] ? -1 : 1;
}

/** HERMITHUB_AUTO_UPDATE=1|0 wins over the setting saved from the web or `hermithub auto-update`. */
export function autoUpdate(): { enabled: boolean; fromEnv: boolean } {
  const env = process.env.HERMITHUB_AUTO_UPDATE;
  if (env === "1" || env === "0") return { enabled: env === "1", fromEnv: true };
  return { enabled: getSetting("update.auto") === "1", fromEnv: false };
}

export function setAutoUpdate(enabled: boolean) {
  setSetting("update.auto", enabled ? "1" : "0");
  logActivity("update", `auto-update ${enabled ? "on" : "off"}`);
}

interface Release {
  tag: string;
  url: string;
  publishedAt: string | null;
  assets: Record<string, string>;
}

async function fetchRelease(tag?: string): Promise<Release> {
  const path = tag ? `tags/v${tag.replace(/^v/, "")}` : "latest";
  const res = await fetch(`${API}/repos/${REPO}/releases/${path}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": `hermithub/${VERSION}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) throw new HttpError(404, tag ? `Release ${tag} not found` : "No release found");
  if (!res.ok) throw new HttpError(502, `GitHub answered ${res.status} when checking for updates`);
  const r = (await res.json()) as {
    tag_name: string;
    html_url: string;
    published_at?: string;
    assets?: { name: string; browser_download_url: string }[];
  };
  return {
    tag: r.tag_name,
    url: r.html_url,
    publishedAt: r.published_at ?? null,
    assets: Object.fromEntries((r.assets ?? []).map((a) => [a.name, a.browser_download_url])),
  };
}

let last: { release: Release | null; checkedAt: number; error: string | null } | null = null;

function loadLast() {
  if (last) return last;
  try {
    last = JSON.parse(getSetting("update.lastCheck") ?? "null");
  } catch {}
  return last;
}

export async function updateStatus(opts: { force?: boolean } = {}) {
  const cached = loadLast();
  if (opts.force || !cached || Date.now() - cached.checkedAt > CHECK_EVERY_MS) {
    try {
      last = { release: await fetchRelease(), checkedAt: Date.now(), error: null };
    } catch (e) {
      last = { release: cached?.release ?? null, checkedAt: Date.now(), error: e instanceof Error ? e.message : String(e) };
    }
    setSetting("update.lastCheck", JSON.stringify(last));
  }
  const { release, checkedAt, error } = last!;
  const latest = release?.tag ?? null;
  return {
    current: VERSION,
    latest,
    available: latest ? cmpSemver(latest, VERSION) === 1 : false,
    notesUrl: release?.url ?? null,
    publishedAt: release?.publishedAt ?? null,
    checkedAt,
    error,
    kind: INSTALL_KIND,
    canInstall: INSTALL_KIND === "binary",
    installing,
    auto: autoUpdate(),
  };
}

export type UpdateStatus = Awaited<ReturnType<typeof updateStatus>>;

async function sha256(path: string) {
  return new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
}

let installing = false;

/**
 * Downloads the release's executable next to the current one, checks it against SHA256SUMS and that it starts,
 * then renames it over the current file. The running process keeps its copy until it restarts.
 */
export async function installUpdate(opts: { tag?: string; target?: string; binPath?: string } = {}) {
  const target = opts.target ?? TARGET;
  const binPath = opts.binPath ?? process.execPath;
  if (!target) throw new HttpError(400, "Only the standalone executable can update itself");
  if (installing) throw new HttpError(409, "An update is already running");
  installing = true;
  const tmp = join(dirname(binPath), ".hermithub.new");
  try {
    const release = await fetchRelease(opts.tag);
    const name = `hermithub-${target}`;
    const binUrl = release.assets[name];
    const sumsUrl = release.assets["SHA256SUMS"];
    if (!binUrl || !sumsUrl) throw new HttpError(404, `Release ${release.tag} has no ${name}`);

    const sums = await fetch(sumsUrl, { signal: AbortSignal.timeout(30_000) });
    if (!sums.ok) throw new HttpError(502, `Download failed: SHA256SUMS (${sums.status})`);
    const expected = (await sums.text()).split("\n").find((l) => l.trim().endsWith(`  ${name}`))?.split(/\s+/)[0];
    if (!expected) throw new HttpError(502, `No checksum for ${name} in SHA256SUMS`);

    const bin = await fetch(binUrl, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!bin.ok) throw new HttpError(502, `Download failed: ${name} (${bin.status})`);
    await Bun.write(tmp, bin);
    const actual = await sha256(tmp);
    if (actual !== expected) throw new HttpError(502, `Checksum mismatch for ${name}; the update was not installed`);
    await chmod(tmp, 0o755);
    if (process.platform === "darwin") await exec(["xattr", "-d", "com.apple.quarantine", tmp]);

    // HERMITHUB_VERSION would override the version the new executable reports.
    const smoke = await exec([tmp, "version"], { timeoutMs: 15_000, env: { HERMITHUB_VERSION: "" } });
    if (smoke.code !== 0) throw new HttpError(500, `The new version does not start: ${smoke.stderr.trim() || smoke.code}`);

    await rename(tmp, binPath);
    const from = VERSION;
    const to = smoke.stdout.trim() || release.tag;
    logActivity("update", `${from} → ${to}`);
    if (last?.release) last.error = null;
    return { from, to };
  } finally {
    installing = false;
    await rm(tmp, { force: true });
  }
}

/**
 * Run by systemd or launchd, which start the server again after it exits. install.sh sets HERMITHUB_SERVICE; the
 * others cover services set up by hand.
 */
export function supervised() {
  const env = process.env;
  // dev.project-hub: launchd agents set up before the rename (Project Hub).
  const agent = env.XPC_SERVICE_NAME === "dev.hermithub" || env.XPC_SERVICE_NAME === "dev.project-hub";
  return Boolean(env.HERMITHUB_SERVICE || env.INVOCATION_ID || agent);
}

/**
 * Exits so the service manager starts the new executable. Non-zero, because the systemd unit restarts on
 * failure only. Agent sessions live in their own tmux server and keep running.
 */
function restartSoon() {
  setTimeout(() => {
    console.log("Restarting for the update");
    process.exit(75);
  }, 500);
}

async function installAndRestart(tag?: string) {
  const r = await installUpdate({ tag });
  const restarting = supervised();
  if (restarting) restartSoon();
  return { ...r, restarting };
}

/** Checks for a release now and then; installs it too when auto-update is on. */
export function startUpdateScheduler() {
  if (process.env.HERMITHUB_UPDATE_CHECK === "0") return;
  const tick = async () => {
    try {
      const s = await updateStatus();
      if (s.available && s.canInstall && s.auto.enabled && supervised()) {
        console.log(`Auto-update: installing ${s.latest}`);
        await installAndRestart(s.latest!);
      }
    } catch (e) {
      console.error("Update check failed:", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(tick, 60_000);
  setInterval(tick, CHECK_EVERY_MS).unref();
}

export const updateRoutes = new Elysia({ prefix: "/api/update" })
  .get("/", ({ query }) => updateStatus({ force: query.force === "1" }), {
    query: t.Object({ force: t.Optional(t.String()) }),
  })
  .post("/install", ({ body }) => installAndRestart(body.version), {
    body: t.Object({ version: t.Optional(t.String({ maxLength: 40 })) }),
  })
  .put(
    "/auto",
    ({ body }) => {
      setAutoUpdate(body.enabled);
      return autoUpdate();
    },
    { body: t.Object({ enabled: t.Boolean() }) },
  );
