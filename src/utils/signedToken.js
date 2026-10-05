import crypto from 'crypto';

// Shared by every serverless endpoint that checks an HMAC-signed token against an
// expected value (Razorpay payment signatures, the internal "free order" token) --
// was previously copy-pasted verbatim in two files. A plain === would return on the
// first mismatched character, leaking (via response timing) how many leading
// characters of a guessed token were correct; both buffers must be equal length for
// timingSafeEqual to run at all, which a same-length hex digest guarantees.
export function timingSafeHexEqual(expectedHex, givenHex) {
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const givenBuf = Buffer.from(String(givenHex), 'hex');
  return expectedBuf.length === givenBuf.length && crypto.timingSafeEqual(expectedBuf, givenBuf);
}

// Signs an arbitrary server-computed string (e.g. a JSON blob of verified pricing)
// so it can be handed to the browser and carried back unchanged, then trusted again
// server-side without needing to be re-derived from scratch. The caller must sign
// and verify the exact same string byte-for-byte -- never a re-JSON.stringify()'d
// version of a parsed copy, since key order isn't guaranteed to round-trip.
export function signPayload(payloadStr, keySecret) {
  return crypto.createHmac('sha256', keySecret).update(payloadStr).digest('hex');
}

// How long a signed pricing blob stays acceptable. Long enough for a slow UPI
// approval, short enough that a price/coupon decision cannot be redeemed days later.
export const BLOB_MAX_AGE_MS = 3 * 60 * 60 * 1000;

// Signs `fields` together with an issue time. The exact returned `blob` string must be
// carried through the browser untouched and handed to readBlob() unchanged.
export function issueBlob(fields, keySecret, now = Date.now()) {
  const blob = JSON.stringify({ ...fields, iat: now });
  return { blob, blobSig: signPayload(blob, keySecret) };
}

// Verifies signature, shape and age. Returns { ok: true, data } or { ok: false, reason }
// where reason is MALFORMED | SIGNATURE | EXPIRED.
export function readBlob(blob, blobSig, keySecret, { now = Date.now(), maxAgeMs = BLOB_MAX_AGE_MS } = {}) {
  if (typeof blob !== 'string' || typeof blobSig !== 'string') return { ok: false, reason: 'MALFORMED' };
  if (!timingSafeHexEqual(signPayload(blob, keySecret), blobSig)) return { ok: false, reason: 'SIGNATURE' };
  let data;
  try { data = JSON.parse(blob); } catch { return { ok: false, reason: 'MALFORMED' }; }
  if (!data || typeof data !== 'object' || !data.computed || !data.receipt) return { ok: false, reason: 'MALFORMED' };
  const iat = Number(data.iat);
  const fiveMinutes = 5 * 60 * 1000;
  if (!Number.isFinite(iat) || now - iat > maxAgeMs || iat - now > fiveMinutes) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, data };
}
