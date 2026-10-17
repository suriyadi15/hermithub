import { createHmac, timingSafeEqual } from "node:crypto";

/** TOTP (RFC 6238): HMAC-SHA1, 6 digits, 30-second steps — what every authenticator app expects. */
const PERIOD = 30;
const DIGITS = 6;
/** Steps accepted on either side of the current one, for clock drift. */
const DRIFT = 1;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Uint8Array) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string) {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret() {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export function stepAt(now = Date.now()) {
  return Math.floor(now / 1000 / PERIOD);
}

export function totpAt(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Return the step the code belongs to, or null. Steps at or before `lastStep` are refused, so a code
 * that was already used (or an older one) cannot be replayed.
 */
export function verifyTotp(secret: string, code: string, now = Date.now(), lastStep = -1): number | null {
  const given = Buffer.from(code.replace(/\s/g, ""));
  if (given.length !== DIGITS) return null;
  const cur = stepAt(now);
  for (let step = cur - DRIFT; step <= cur + DRIFT; step++) {
    if (step <= lastStep) continue;
    if (timingSafeEqual(given, Buffer.from(totpAt(secret, step)))) return step;
  }
  return null;
}

export function otpauthUri(secret: string) {
  const label = encodeURIComponent("Project Hub");
  return `otpauth://totp/${label}?secret=${secret}&issuer=${label}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;
}

/** Ten single-use recovery codes like `k3f9-2xqm` (40 random bits each). */
export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const s = base32Encode(crypto.getRandomValues(new Uint8Array(5))).toLowerCase();
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

export function normalizeRecoveryCode(code: string) {
  return code.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}
