import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// auth.ts opens the database on import: keep it away from the real data folder.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "hermithub-auth-"));
process.env.HERMITHUB_DB = ":memory:";
const { clientIp, hashToken, locked, publicOrigin, recordFail, resetFails } = await import("../src/auth");

const server = { requestIP: () => ({ address: "10.0.0.9" }) };
const req = (headers: Record<string, string>) => new Request("http://hub/api/auth/login", { headers });

describe("clientIp", () => {
  const spoofed = req({ "x-forwarded-for": "6.6.6.6, 1.2.3.4", "cf-connecting-ip": "7.7.7.7" });

  test("ignores forwarded headers by default", () => {
    expect(clientIp(spoofed, server, "")).toBe("10.0.0.9");
  });

  test("TRUST_PROXY=1 takes the entry added by the nearest proxy", () => {
    expect(clientIp(spoofed, server, "1")).toBe("1.2.3.4");
    expect(clientIp(spoofed, server, "true")).toBe("1.2.3.4");
  });

  test("TRUST_PROXY=cloudflare takes CF-Connecting-IP", () => {
    expect(clientIp(spoofed, server, "cloudflare")).toBe("7.7.7.7");
  });

  test("falls back to the socket address when the header is missing", () => {
    expect(clientIp(req({}), server, "1")).toBe("10.0.0.9");
  });
});

describe("login lockout", () => {
  beforeEach(() => resetFails());

  test("locks an IP after 5 failures", () => {
    for (let i = 0; i < 4; i++) recordFail("a");
    expect(locked("a")).toBe(false);
    recordFail("a");
    expect(locked("a")).toBe(true);
    expect(locked("b")).toBe(false);
  });

  test("locks everyone when failures come from many IPs", () => {
    for (let i = 0; i < 30; i++) recordFail(`ip-${i}`);
    expect(locked("fresh")).toBe(true);
  });

  test("lockouts expire", () => {
    const now = Date.now();
    for (let i = 0; i < 30; i++) recordFail("a", now);
    expect(locked("a", now + 16 * 60 * 1000)).toBe(false);
  });
});

test("session tokens are stored hashed", () => {
  expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

describe("publicOrigin", () => {
  test("prefers the first PUBLIC_ORIGIN", () => {
    expect(publicOrigin({ PUBLIC_ORIGIN: "https://a.example, https://b.example", RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" }, 8787)).toBe(
      "https://a.example",
    );
  });

  test("falls back to the domain a host platform assigned", () => {
    expect(publicOrigin({ RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" }, 8787)).toBe("https://x.up.railway.app");
    expect(publicOrigin({ RENDER_EXTERNAL_URL: "https://x.onrender.com/" }, 8787)).toBe("https://x.onrender.com");
  });

  test("defaults to localhost", () => {
    expect(publicOrigin({}, 9000)).toBe("http://localhost:9000");
  });
});
