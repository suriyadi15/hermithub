import { cpus } from "node:os";
import { exec } from "./exec";
import { PROJECTS_DIR } from "./paths";

/** Host-wide numbers: /proc/loadavg and /proc/meminfo are not namespaced, so this works inside Docker too. */
export async function serverStats() {
  const [loadavg, meminfo, df] = await Promise.all([
    Bun.file("/proc/loadavg").text().catch(() => "0 0 0"),
    Bun.file("/proc/meminfo").text().catch(() => ""),
    exec(["df", "-Pk", PROJECTS_DIR]),
  ]);
  const mem = (key: string) => Number(meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1] ?? 0) * 1024;
  const [, size, used, avail] = df.stdout.trim().split("\n").pop()?.split(/\s+/) ?? [];
  return {
    load: loadavg.split(" ").slice(0, 3).map(Number),
    cpus: cpus().length,
    mem: { total: mem("MemTotal"), available: mem("MemAvailable") },
    disk: { total: Number(size) * 1024, used: Number(used) * 1024, available: Number(avail) * 1024 },
  };
}
