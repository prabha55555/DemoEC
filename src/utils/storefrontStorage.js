// Small per-browser memories for the storefront: recently viewed products and recent searches.
// Both are conveniences -- a blocked/full localStorage just means they are not remembered.

const RECENT_KEY = 'tt_recent';            // product ids only (never snapshots: price and stock are read live)
const SEARCHES_KEY = 'tt_recent_searches';

function readList(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : [];
  } catch { return []; }
}
function writeList(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage blocked -- not remembered */ }
}

export const readRecentIds = () => readList(RECENT_KEY);

// Most recent first, no duplicates, at most 10.
export function pushRecentId(id) {
  if (!id) return readRecentIds();
  const next = [id, ...readRecentIds().filter(x => x !== id)].slice(0, 10);
  writeList(RECENT_KEY, next);
  return next;
}

export const readRecentSearches = () => readList(SEARCHES_KEY);

export function pushRecentSearch(text) {
  const q = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!q) return readRecentSearches();
  const next = [q, ...readRecentSearches().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  writeList(SEARCHES_KEY, next);
  return next;
}

export function clearRecentSearches() { writeList(SEARCHES_KEY, []); }
