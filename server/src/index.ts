import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Elysia, status, t } from "elysia";
import { authRoutes, ensurePassword, initSetupToken, isAuthed, originOk } from "./auth";
import { agentRoutes } from "./agents";
import { recentActivity } from "./db";
import { HttpError } from "./exec";
import { fileRoutes } from "./files";
import { gitRoutes } from "./git";
import { PROJECTS_DIR } from "./paths";
import { projectRoutes } from "./projects";
import { searchRoutes } from "./search";
import { integrationRoutes } from "./integrations";
import { sessionRoutes } from "./sessions";
import { serverStats } from "./stats";
import { taskRoutes } from "./tasks";
import { terminalRoutes } from "./terminal";
import { worktreeRoutes } from "./worktrees";
import { applyGlobalOptions } from "./tmux";
import { startUpdateScheduler, updateRoutes, VERSION } from "./update";
import { embeddedWebFile } from "./web-embed";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const WEB_DIST = resolve(process.env.WEB_DIST ?? join(import.meta.dir, "../../web/dist"));
const PUBLIC_API = new Set(["/api/health", "/api/auth/login", "/api/auth/me", "/api/auth/logout", "/api/auth/setup"]);

/** No framing (clickjacking), no MIME sniffing of served files, no setup token leaking via Referer. */
const SECURITY_HEADERS = {
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const api = new Elysia()
  .onRequest(({ request, set }) => {
    Object.assign(set.headers, SECURITY_HEADERS);
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/api/") && !path.startsWith("/ws/")) return;
    if ((request.method !== "GET" || path.startsWith("/ws/")) && !originOk(request)) {
      return status(403, { error: "Origin not allowed" });
    }
    if (!PUBLIC_API.has(path) && !isAuthed(request)) {
      return status(401, { error: "Unauthorized" });
    }
  })
  .onError(({ error, code }) => {
    if (error instanceof HttpError) return status(error.status, { error: error.message });
    if (code === "VALIDATION") return status(400, { error: "Invalid input" });
    if (code === "NOT_FOUND") return status(404, { error: "Not found" });
    console.error(error);
    return status(500, { error: error instanceof Error ? error.message : "Internal error" });
  })
  .get("/api/health", () => ({ ok: true }))
  .use(authRoutes)
  .use(projectRoutes)
  .use(gitRoutes)
  .use(worktreeRoutes)
  .use(fileRoutes)
  .use(searchRoutes)
  .use(sessionRoutes)
  .use(terminalRoutes)
  .use(agentRoutes)
  .use(taskRoutes)
  .use(integrationRoutes)
  .use(updateRoutes)
  .get("/api/stats", () => serverStats())
  .get("/api/activity", () => recentActivity(30))
  .get("/api/settings", () => ({ projectsDir: PROJECTS_DIR, version: VERSION }));

export type App = typeof api;

/**
 * Built SPA: serve the file if it exists, otherwise index.html so client-side routes work. web/dist on disk wins;
 * the standalone executable falls back to the copy built into it.
 */
const app = api.get("/*", async ({ path, set }) => {
  if (path.startsWith("/api/") || path.startsWith("/ws/")) return status(404, { error: "Not found" });
  const rel = decodeURIComponent(path);
  const file = Bun.file(resolve(WEB_DIST, "." + rel));
  const found = file.name!.startsWith(WEB_DIST + "/") && (await file.exists()) ? file : embeddedWebFile(rel);
  if (found) {
    if (path.startsWith("/assets/")) set.headers["cache-control"] = "public, max-age=31536000, immutable";
    return found;
  }
  const index = Bun.file(join(WEB_DIST, "index.html"));
  if (await index.exists()) return index;
  const embeddedIndex = embeddedWebFile("/index.html");
  if (embeddedIndex) return embeddedIndex;
  return new Response("Frontend not built yet. Run `bun run build`.", { status: 503 });
});

export async function start() {
  // The Docker entrypoint creates it; the standalone install starts with an empty home.
  mkdirSync(PROJECTS_DIR, { recursive: true });
  await ensurePassword();
  const token = initSetupToken();
  await applyGlobalOptions(); // no-op when no tmux server is running yet
  startUpdateScheduler();
  app.listen({ port: PORT, hostname: HOST, idleTimeout: 120 });
  console.log(`HermitHub on http://${HOST}:${PORT} — projects: ${PROJECTS_DIR}`);
  if (token) {
    const origin = (process.env.PUBLIC_ORIGIN ?? "").split(",")[0]?.trim() || `http://localhost:${PORT}`;
    console.log(`\nFirst run: create your password at\n  ${origin}/setup?token=${token}\n`);
  }
}

if (import.meta.main) await start();

export { app };
