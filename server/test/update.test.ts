import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A fake GitHub: the releases API plus the release files.
const NEW_BIN = "#!/bin/sh\necho 9.9.9\n";
let sums = "";
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const { pathname, origin: base } = new URL(req.url);
    if (pathname === "/repos/test/hub/releases/latest" || pathname === "/repos/test/hub/releases/tags/v9.9.9") {
      return Response.json({
        tag_name: "v9.9.9",
        html_url: `${base}/notes`,
        assets: [
          { name: "project-hub-linux-x64", browser_download_url: `${base}/dl/project-hub-linux-x64` },
          { name: "SHA256SUMS", browser_download_url: `${base}/dl/SHA256SUMS` },
        ],
      });
    }
    if (pathname === "/dl/project-hub-linux-x64") return new Response(NEW_BIN);
    if (pathname === "/dl/SHA256SUMS") return new Response(sums);
    return new Response("not found", { status: 404 });
  },
});
afterAll(() => server.stop(true));

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "hub-update-"));
process.env.HUB_DB = ":memory:";
process.env.HUB_UPDATE_API = `http://localhost:${server.port}`;
process.env.HUB_REPO = "test/hub";
process.env.HUB_VERSION = "1.0.0";
delete process.env.HUB_AUTO_UPDATE;
const { autoUpdate, cmpSemver, installUpdate, setAutoUpdate, updateStatus } = await import("../src/update");

const hash = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

describe("cmpSemver", () => {
  test("orders versions", () => {
    expect(cmpSemver("v0.5.0", "0.4.9")).toBe(1);
    expect(cmpSemver("0.4.0", "v0.4.0")).toBe(0);
    expect(cmpSemver("0.10.0", "0.9.0")).toBe(1);
    expect(cmpSemver("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(cmpSemver("1.0.0", "1.0.0-rc.1")).toBe(1);
  });
  test("ignores non-versions", () => {
    expect(cmpSemver("v1.0.0", "dev")).toBeNull();
  });
});

describe("updateStatus", () => {
  test("reports the newer release", async () => {
    const s = await updateStatus({ force: true });
    expect(s).toMatchObject({ current: "1.0.0", latest: "v9.9.9", available: true, error: null });
  });
});

describe("auto-update", () => {
  beforeEach(() => delete process.env.HUB_AUTO_UPDATE);
  test("off by default, toggles", () => {
    expect(autoUpdate()).toEqual({ enabled: false, fromEnv: false });
    setAutoUpdate(true);
    expect(autoUpdate().enabled).toBe(true);
    setAutoUpdate(false);
    expect(autoUpdate().enabled).toBe(false);
  });
  test("the environment wins", () => {
    setAutoUpdate(false);
    process.env.HUB_AUTO_UPDATE = "1";
    expect(autoUpdate()).toEqual({ enabled: true, fromEnv: true });
  });
});

describe("installUpdate", () => {
  const dir = mkdtempSync(join(tmpdir(), "hub-bin-"));
  const binPath = join(dir, "project-hub");
  beforeEach(() => writeFileSync(binPath, "old"));

  test("replaces the executable after checking the checksum", async () => {
    sums = `${hash("other")}  project-hub-linux-arm64\n${hash(NEW_BIN)}  project-hub-linux-x64\n`;
    const r = await installUpdate({ target: "linux-x64", binPath });
    expect(r).toEqual({ from: "1.0.0", to: "9.9.9" });
    expect(readFileSync(binPath, "utf8")).toBe(NEW_BIN);
  });

  test("refuses a checksum mismatch", async () => {
    sums = `${hash("tampered")}  project-hub-linux-x64\n`;
    await expect(installUpdate({ target: "linux-x64", binPath, tag: "v9.9.9" })).rejects.toThrow(/Checksum mismatch/);
    expect(readFileSync(binPath, "utf8")).toBe("old");
  });

  test("refuses a missing asset", async () => {
    await expect(installUpdate({ target: "darwin-arm64", binPath })).rejects.toThrow(/has no project-hub-darwin-arm64/);
  });
});
