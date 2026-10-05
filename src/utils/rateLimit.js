// SERVER-ONLY. A small fixed-window rate limiter for the public /api endpoints.
//
// State lives in this serverless instance's memory, so it slows down a single client
// hammering one warm instance (gift-card guessing, reservation hoarding) but is not a
// global guarantee: Vercel may run several instances at once and recycles them. It is a
// cheap first line of defence; a platform-level limit (Vercel WAF / a shared store) is
// the real fix and is listed as a dashboard task.
const windows = new Map();
const MAX_TRACKED_KEYS = 5000;

export function clientIp(req) {
  const headers = req?.headers || {};
  const direct = headers['x-vercel-forwarded-for'] || headers['x-real-ip'];
  if (typeof direct === 'string' && direct.trim()) return direct.split(',')[0].trim();
  const forwarded = headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req?.socket?.remoteAddress || 'unknown';
}

// Returns true when `key` has used up `limit` units within the current `windowMs`.
// `cost` lets a batch request count as several lookups.
export function isRateLimited(key, { limit, windowMs, cost = 1, now = Date.now() }) {
  if (windows.size > MAX_TRACKED_KEYS) {
    for (const [k, w] of windows) if (now - w.start >= w.windowMs) windows.delete(k);
    if (windows.size > MAX_TRACKED_KEYS) windows.clear();
  }
  const current = windows.get(key);
  if (!current || now - current.start >= windowMs) {
    windows.set(key, { start: now, count: cost, windowMs });
    return cost > limit;
  }
  current.count += cost;
  return current.count > limit;
}

export function resetRateLimits() {
  windows.clear();
}
