import { timingSafeEqual } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Elysia, status, t } from "elysia";
import { db, getSetting, logActivity, setSetting } from "./db";
import { DATA_DIR } from "./paths";

export const COOKIE = "hub_session";
const SESSION_TTL = 30 * 24 * 3600 * 1000;
const MAX_FAILS = 5;
const FAIL_WINDOW = 15 * 60 * 1000;

/** Seed the password from the environment (headless installs); the DB value wins afterwards. */
export async function ensurePassword() {
  if (getSetting("password_hash")) return true;
  const hash = process.env.HUB_PASSWORD_HASH;
  const plain = process.env.HUB_PASSWORD;
  if (hash) setSetting("password_hash", hash);
  else if (plain) setSetting("password_hash", await Bun.password.hash(plain));
  else return false;
  return true;
}

export function needsSetup() {
  return !getSetting("password_hash");
}

/**
 * Until a password exists, the first visitor creates it on the setup page. A random token, printed in
 * the logs and written to DATA_DIR/setup-token, proves they control the server and not just the port.
 */
let setupToken: string | null = null;
const SETUP_TOKEN_FILE = join(DATA_DIR, "setup-token");

export function initSetupToken(): string | null {
  if (!needsSetup()) {
    rmSync(SETUP_TOKEN_FILE, { force: true });
    return null;
  }
  setupToken = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");
  writeFileSync(SETUP_TOKEN_FILE, setupToken + "\n", { mode: 0o600 });
  return setupToken;
}

function tokenMatches(given: string) {
  if (!setupToken) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(setupToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function setPassword(plain: string) {
  if (plain.length < 8) throw new Error("Password must be at least 8 characters");
  setSetting("password_hash", await Bun.password.hash(plain));
  db.query("DELETE FROM auth_sessions").run();
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function isAuthed(request: Request): boolean {
  const token = parseCookies(request.headers.get("cookie"))[COOKIE];
  if (!token) return false;
  const row = db
    .query<{ expires_at: number }, [string]>("SELECT expires_at FROM auth_sessions WHERE token = ?")
    .get(token);
  return !!row && row.expires_at > Date.now();
}

/**
 * Reject cross-site requests: browsers always send Origin on WebSocket upgrades and on
 * non-GET fetches, so it must match the host the page was served from.
 */
export function originOk(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = (process.env.PUBLIC_ORIGIN ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.includes(origin)) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function isHttps(request: Request) {
  return (
    request.headers.get("x-forwarded-proto") === "https" ||
    request.url.startsWith("https:") ||
    (process.env.PUBLIC_ORIGIN ?? "").startsWith("https:")
  );
}

function cookieHeader(request: Request, value: string, maxAgeSec: number) {
  return [
    `${COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSec}`,
    isHttps(request) ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** Create a login session and return the Set-Cookie header for it. */
function startLogin(request: Request) {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const now = Date.now();
  db.query("DELETE FROM auth_sessions WHERE expires_at < ?").run(now);
  db.query("INSERT INTO auth_sessions (token, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?)").run(
    token,
    now,
    now + SESSION_TTL,
    request.headers.get("user-agent"),
  );
  return cookieHeader(request, token, SESSION_TTL / 1000);
}

const fails = new Map<string, { count: number; until: number }>();

function locked(ip: string) {
  const f = fails.get(ip);
  return !!f && f.count >= MAX_FAILS && f.until > Date.now();
}

function recordFail(ip: string) {
  const f = fails.get(ip);
  const cur = f && f.until > Date.now() ? f : { count: 0, until: Date.now() + FAIL_WINDOW };
  cur.count++;
  fails.set(ip, cur);
}

export function clientIp(request: Request, server: { requestIP(r: Request): { address: string } | null } | null) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    server?.requestIP(request)?.address ||
    "unknown"
  );
}

export const authRoutes = new Elysia({ prefix: "/api/auth" })
  .post(
    "/login",
    async ({ body, request, server, set }) => {
      const ip = clientIp(request, server);
      if (locked(ip)) return status(429, { error: "Too many attempts. Try again later." });
      const hash = getSetting("password_hash");
      if (!hash) return status(503, { error: "No password yet. Finish the setup page first." });
      if (!(await Bun.password.verify(body.password, hash))) {
        recordFail(ip);
        logActivity("login_failed", ip);
        return status(401, { error: "Wrong password" });
      }
      fails.delete(ip);
      logActivity("login", ip);
      set.headers["set-cookie"] = startLogin(request);
      return { ok: true };
    },
    { body: t.Object({ password: t.String({ maxLength: 512 }) }) },
  )
  .post("/logout", ({ request, set }) => {
    const token = parseCookies(request.headers.get("cookie"))[COOKIE];
    if (token) db.query("DELETE FROM auth_sessions WHERE token = ?").run(token);
    set.headers["set-cookie"] = cookieHeader(request, "", 0);
    return { ok: true };
  })
  .get("/me", ({ request }) => ({ authed: isAuthed(request), needsSetup: needsSetup() }))
  .post(
    "/setup",
    async ({ body, request, server, set }) => {
      const ip = clientIp(request, server);
      if (!needsSetup()) return status(409, { error: "Setup is already done. Log in instead." });
      if (locked(ip)) return status(429, { error: "Too many attempts. Try again later." });
      if (!tokenMatches(body.token.trim())) {
        recordFail(ip);
        logActivity("setup_failed", ip);
        return status(401, { error: "Invalid setup token" });
      }
      try {
        await setPassword(body.password);
      } catch (e: any) {
        return status(400, { error: e.message as string });
      }
      setupToken = null;
      rmSync(SETUP_TOKEN_FILE, { force: true });
      logActivity("setup", ip);
      set.headers["set-cookie"] = startLogin(request);
      return { ok: true };
    },
    { body: t.Object({ token: t.String({ maxLength: 128 }), password: t.String({ maxLength: 512 }) }) },
  )
  .post(
    "/password",
    async ({ body, request, set }) => {
      if (!isAuthed(request)) return status(401, { error: "Unauthorized" });
      const hash = getSetting("password_hash");
      if (!hash || !(await Bun.password.verify(body.current, hash))) {
        return status(400, { error: "Current password is wrong" });
      }
      try {
        await setPassword(body.next);
      } catch (e: any) {
        return status(400, { error: e.message as string });
      }
      logActivity("password_changed");
      set.headers["set-cookie"] = cookieHeader(request, "", 0);
      return { ok: true };
    },
    { body: t.Object({ current: t.String({ maxLength: 512 }), next: t.String({ maxLength: 512 }) }) },
  );
