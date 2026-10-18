import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./paths";

mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(process.env.HUB_DB ?? join(DATA_DIR, "hub.db"), { create: true });
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  name TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  mode TEXT NOT NULL,
  permission TEXT,
  label TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS project_flags (
  name TEXT PRIMARY KEY,
  favorite INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0
);
`);

// Added in 0.4: the git worktree a session ran in ("" or NULL = the project folder).
if (!db.query<{ name: string }, []>("PRAGMA table_info(sessions)").all().some((c) => c.name === "worktree")) {
  db.exec("ALTER TABLE sessions ADD COLUMN worktree TEXT");
}

export function getSetting(key: string): string | null {
  const row = db.query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?").get(key);
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db.query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    value,
  );
}

export function deleteSetting(key: string) {
  db.query("DELETE FROM settings WHERE key = ?").run(key);
}

export function logActivity(action: string, detail?: string) {
  db.query("INSERT INTO activity (ts, action, detail) VALUES (?, ?, ?)").run(Date.now(), action, detail ?? null);
  db.query("DELETE FROM activity WHERE id <= (SELECT MAX(id) - 1000 FROM activity)").run();
}

export function recentActivity(limit = 50) {
  return db
    .query<{ ts: number; action: string; detail: string | null }, [number]>(
      "SELECT ts, action, detail FROM activity ORDER BY id DESC LIMIT ?",
    )
    .all(limit);
}
