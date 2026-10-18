import { createHash, timingSafeEqual } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Elysia, status, t } from "elysia";
import { db, deleteSetting, getSetting, logActivity, setSetting } from "./db";
import { DATA_DIR } from "./paths";
import {
  generateRecoveryCodes,
  generateSecret,
  normalizeRecoveryCode,
  otpauthUri,
  verifyTotp,
} from "./totp";

export const COOKIE = "hermithub_session";
const SESSION_TTL = 30 * 24 * 3600 * 1000;
const MAX_FAILS = 5;
const FAIL_WINDOW = 15 * 60 * 1000;
/** Failed attempts from all IPs together before every login is paused; a backstop if IPs rotate. */
const MAX_GLOBAL_FAILS = 30;

/** Seed the password from the environment (headless installs); the DB value wins afterwards. */
export async function ensurePassword() {
  if (getSetting("password_hash")) return true;
  const hash = process.env.HERMITHUB_PASSWORD_HASH;
  const plain = process.env.HERMITHUB_PASSWORD;
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

export function totpEnabled() {
  return !!getSetting("totp_secret");
}

export function disableTotp() {
  for (const key of ["totp_secret", "totp_pending_secret", "totp_last_step", "totp_recovery"]) deleteSetting(key);
}

function newRecoveryCodes() {
  const codes = generateRecoveryCodes();
  setSetting("totp_recovery", JSON.stringify(codes.map((c) => hashToken(normalizeRecoveryCode(c)))));
  return codes;
}

/**
 * Check a second-factor code: a current authenticator code (never the same one twice) or an unused
 * recovery code, which is then spent.
 */
export function checkSecondFactor(code: string, now = Date.now()): "totp" | "recovery" | null {
  const secret = getSetting("totp_secret");
  if (!secret) return null;
  const step = verifyTotp(secret, code, now, Number(getSetting("totp_last_step") ?? -1));
  if (step !== null) {
    setSetting("totp_last_step", String(step));
    return "totp";
  }
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) return null;
  const hashes: string[] = JSON.parse(getSetting("totp_recovery") ?? "[]");
  const i = hashes.indexOf(hashToken(normalized));
  if (i < 0) return null;
  hashes.splice(i, 1);
  setSetting("totp_recovery", JSON.stringify(hashes));
  return "recovery";
}

function recoveryLeft() {
  return (JSON.parse(getSetting("totp_recovery") ?? "[]") as string[]).length;
}

async function passwordOk(plain: string) {
  const hash = getSetting("password_hash");
  return !!hash && (await Bun.password.verify(plain, hash));
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Only a hash of each session token is stored, so a leaked database does not hand out logins. */
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// Sessions from before tokens were hashed can no longer match; drop them (one-time sign-out).
if (!getSetting("session_tokens_hashed")) {
  db.query("DELETE FROM auth_sessions").run();
  setSetting("session_tokens_hashed", "1");
}

export function isAuthed(request: Request): boolean {
  const token = parseCookies(request.headers.get("cookie"))[COOKIE];
  if (!token) return false;
  const row = db
    .query<{ expires_at: number }, [string]>("SELECT expires_at FROM auth_sessions WHERE token = ?")
    .get(hashToken(token));
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

/** Where the dashboard is reached from outside, for the setup link: PUBLIC_ORIGIN, else the domain a host platform assigned. */
export function publicOrigin(env: Record<string, string | undefined>, port: number) {
  const configured = (env.PUBLIC_ORIGIN ?? "").split(",")[0]?.trim();
  if (configured) return configured;
  if (env.RAILWAY_PUBLIC_DOMAIN) return `https://${env.RAILWAY_PUBLIC_DOMAIN}`;
  if (env.RENDER_EXTERNAL_URL) return env.RENDER_EXTERNAL_URL.replace(/\/$/, "");
  return `http://localhost:${port}`;
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
    hashToken(token),
    now,
    now + SESSION_TTL,
    request.headers.get("user-agent"),
  );
  return cookieHeader(request, token, SESSION_TTL / 1000);
}

type FailCount = { count: number; until: number };
const fails = new Map<string, FailCount>();
let globalFails: FailCount = { count: 0, until: 0 };

export function locked(ip: string, now = Date.now()) {
  const f = fails.get(ip);
  if (f && f.count >= MAX_FAILS && f.until > now) return true;
  return globalFails.count >= MAX_GLOBAL_FAILS && globalFails.until > now;
}

function bump(f: FailCount | undefined, now: number): FailCount {
  const cur = f && f.until > now ? f : { count: 0, until: now + FAIL_WINDOW };
  cur.count++;
  return cur;
}

export function recordFail(ip: string, now = Date.now()) {
  for (const [k, f] of fails) if (f.until <= now) fails.delete(k);
  fails.set(ip, bump(fails.get(ip), now));
  globalFails = bump(globalFails, now);
}

export function resetFails() {
  fails.clear();
  globalFails = { count: 0, until: 0 };
}

/**
 * IP used for the login lockout. Forwarded headers can be set by anyone, so they only count when
 * TRUST_PROXY says a proxy in front sets them: "1"/"true" = the last X-Forwarded-For entry (the one
 * added by the nearest proxy), "cloudflare" = CF-Connecting-IP. Otherwise the socket address is used.
 */
export function clientIp(
  request: Request,
  server: { requestIP(r: Request): { address: string } | null } | null,
  trust = process.env.TRUST_PROXY ?? "",
) {
  const mode = trust.trim().toLowerCase();
  let ip: string | undefined;
  if (mode === "cloudflare") ip = request.headers.get("cf-connecting-ip")?.trim();
  else if (mode === "1" || mode === "true") ip = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
  return ip || server?.requestIP(request)?.address || "unknown";
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
      if (totpEnabled()) {
        const code = body.code?.trim();
        if (!code) return status(401, { error: "Enter the code from your authenticator app", totp: true });
        const factor = checkSecondFactor(code);
        if (!factor) {
          recordFail(ip);
          logActivity("login_failed_totp", ip);
          return status(401, { error: "Wrong authentication code", totp: true });
        }
        if (factor === "recovery") logActivity("recovery_code_used", ip);
      }
      fails.delete(ip);
      logActivity("login", ip);
      set.headers["set-cookie"] = startLogin(request);
      return { ok: true };
    },
    { body: t.Object({ password: t.String({ maxLength: 512 }), code: t.Optional(t.String({ maxLength: 32 })) }) },
  )
  .post("/logout", ({ request, set }) => {
    const token = parseCookies(request.headers.get("cookie"))[COOKIE];
    if (token) db.query("DELETE FROM auth_sessions WHERE token = ?").run(hashToken(token));
    set.headers["set-cookie"] = cookieHeader(request, "", 0);
    return { ok: true };
  })
  .get("/me", ({ request }) => {
    const authed = isAuthed(request);
    return {
      authed,
      needsSetup: needsSetup(),
      totpEnabled: authed ? totpEnabled() : undefined,
      recoveryLeft: authed && totpEnabled() ? recoveryLeft() : undefined,
    };
  })
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
  )
  .post(
    "/totp/setup",
    async ({ body, request }) => {
      if (!isAuthed(request)) return status(401, { error: "Unauthorized" });
      if (totpEnabled()) return status(409, { error: "Two-factor authentication is already on" });
      if (!(await passwordOk(body.password))) return status(400, { error: "Password is wrong" });
      const secret = generateSecret();
      setSetting("totp_pending_secret", secret);
      return { secret, uri: otpauthUri(secret) };
    },
    { body: t.Object({ password: t.String({ maxLength: 512 }) }) },
  )
  .post(
    "/totp/enable",
    ({ body, request }) => {
      if (!isAuthed(request)) return status(401, { error: "Unauthorized" });
      const secret = getSetting("totp_pending_secret");
      if (!secret) return status(400, { error: "Start the setup again" });
      const step = verifyTotp(secret, body.code);
      if (step === null) return status(400, { error: "Wrong code. Check the time on your phone and try again." });
      setSetting("totp_secret", secret);
      setSetting("totp_last_step", String(step));
      deleteSetting("totp_pending_secret");
      const codes = newRecoveryCodes();
      // Other devices logged in with the password alone; sign them out.
      const token = parseCookies(request.headers.get("cookie"))[COOKIE]!;
      db.query("DELETE FROM auth_sessions WHERE token != ?").run(hashToken(token));
      logActivity("totp_enabled");
      return { recoveryCodes: codes };
    },
    { body: t.Object({ code: t.String({ maxLength: 32 }) }) },
  )
  .post(
    "/totp/disable",
    async ({ body, request }) => {
      if (!isAuthed(request)) return status(401, { error: "Unauthorized" });
      if (!(await passwordOk(body.password))) return status(400, { error: "Password is wrong" });
      if (!checkSecondFactor(body.code)) return status(400, { error: "Wrong authentication code" });
      disableTotp();
      logActivity("totp_disabled");
      return { ok: true };
    },
    { body: t.Object({ password: t.String({ maxLength: 512 }), code: t.String({ maxLength: 32 }) }) },
  )
  .post(
    "/totp/recovery",
    async ({ body, request }) => {
      if (!isAuthed(request)) return status(401, { error: "Unauthorized" });
      if (!totpEnabled()) return status(400, { error: "Two-factor authentication is off" });
      if (!(await passwordOk(body.password))) return status(400, { error: "Password is wrong" });
      if (!checkSecondFactor(body.code)) return status(400, { error: "Wrong authentication code" });
      logActivity("totp_recovery_regenerated");
      return { recoveryCodes: newRecoveryCodes() };
    },
    { body: t.Object({ password: t.String({ maxLength: 512 }), code: t.String({ maxLength: 32 }) }) },
  );
