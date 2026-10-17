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
import { applyGlobalOptions } from "./tmux";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const WEB_DIST = resolve(process.env.WEB_DIST ?? join(import.meta.dir, "../../web/dist"));
const VERSION: string =
  process.env.HUB_VERSION || ((await Bun.file(join(import.meta.dir, "../../package.json")).json()).version ?? "dev");
const PUBLIC_API = new Set(["/api/health", "/api/auth/login", "/api/auth/me", "/api/auth/logout", "/api/auth/setup"]);

const api = new Elysia()
  .onRequest(({ request }) => {
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
  .use(fileRoutes)
  .use(searchRoutes)
  .use(sessionRoutes)
  .use(terminalRoutes)
  .use(agentRoutes)
  .use(taskRoutes)
  .use(integrationRoutes)
  .get("/api/stats", () => serverStats())
  .get("/api/activity", () => recentActivity(30))
  .get("/api/settings", () => ({ projectsDir: PROJECTS_DIR, version: VERSION }));

export type App = typeof api;

/** Built SPA: serve the file if it exists, otherwise index.html so client-side routes work. */
const app = api.get("/*", async ({ path, set }) => {
  if (path.startsWith("/api/") || path.startsWith("/ws/")) return status(404, { error: "Not found" });
  const file = Bun.file(resolve(WEB_DIST, "." + decodeURIComponent(path)));
  if (file.name!.startsWith(WEB_DIST + "/") && (await file.exists())) {
    if (path.startsWith("/assets/")) set.headers["cache-control"] = "public, max-age=31536000, immutable";
    return file;
  }
  const index = Bun.file(join(WEB_DIST, "index.html"));
  if (await index.exists()) return index;
  return new Response("Frontend not built yet. Run `bun run build`.", { status: 503 });
});

if (import.meta.main) {
  await ensurePassword();
  const token = initSetupToken();
  await applyGlobalOptions(); // no-op when no tmux server is running yet
  app.listen({ port: PORT, hostname: HOST, idleTimeout: 120 });
  console.log(`Project Hub on http://${HOST}:${PORT} — projects: ${PROJECTS_DIR}`);
  if (token) {
    const origin = (process.env.PUBLIC_ORIGIN ?? "").split(",")[0]?.trim() || `http://localhost:${PORT}`;
    console.log(`\nFirst run: create your password at\n  ${origin}/setup?token=${token}\n`);
  }
}

export { app };
