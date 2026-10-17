import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// auth.ts opens the database on import: keep it away from the real data folder.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "hub-totp-"));
process.env.HUB_DB = ":memory:";
const { base32Decode, base32Encode, generateRecoveryCodes, stepAt, totpAt, verifyTotp } = await import("../src/totp");
const { checkSecondFactor, disableTotp, hashToken, totpEnabled } = await import("../src/auth");
const { setSetting } = await import("../src/db");

// RFC 6238 appendix B, SHA-1 seed "12345678901234567890" (the 8-digit vectors, last 6 digits).
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  test("base32 round-trips", () => {
    const buf = crypto.getRandomValues(new Uint8Array(20));
    expect(base32Decode(base32Encode(buf))).toEqual(Buffer.from(buf));
  });

  test("matches the RFC 6238 test vectors", () => {
    expect(totpAt(RFC_SECRET, stepAt(59_000))).toBe("287082");
    expect(totpAt(RFC_SECRET, stepAt(1111111109_000))).toBe("081804");
    expect(totpAt(RFC_SECRET, stepAt(1234567890_000))).toBe("005924");
  });

  test("accepts one step of clock drift, not more", () => {
    const now = 1234567890_000;
    const step = stepAt(now);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 2), now)).toBeNull();
  });

  test("refuses codes at or before the last used step", () => {
    const now = 1234567890_000;
    const code = totpAt(RFC_SECRET, stepAt(now));
    expect(verifyTotp(RFC_SECRET, code, now, stepAt(now))).toBeNull();
  });

  test("ignores malformed codes", () => {
    expect(verifyTotp(RFC_SECRET, "12345", 59_000)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "", 59_000)).toBeNull();
  });
});

describe("second factor", () => {
  test("a code works once, recovery codes are single use", () => {
    setSetting("totp_secret", RFC_SECRET);
    const [code] = generateRecoveryCodes(1);
    setSetting("totp_recovery", JSON.stringify([hashToken(code!.replace("-", ""))]));
    expect(totpEnabled()).toBe(true);

    const now = Date.now();
    const current = totpAt(RFC_SECRET, stepAt(now));
    expect(checkSecondFactor(current, now)).toBe("totp");
    expect(checkSecondFactor(current, now)).toBeNull();

    expect(checkSecondFactor(code!.toUpperCase(), now)).toBe("recovery");
    expect(checkSecondFactor(code!, now)).toBeNull();

    disableTotp();
    expect(totpEnabled()).toBe(false);
  });
});
