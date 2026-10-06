// Runs `worker(item, index)` over `items` with at most `limit` in flight at once. Resolves, like
// Promise.allSettled, with one { status, value | reason } per item IN INPUT ORDER -- one failure never
// stops the rest. Used so a 20-photo upload does not open 20 simultaneous connections.
export async function mapWithConcurrency(items, limit, worker) {
  const list = Array.from(items);
  const results = new Array(list.length);
  let next = 0;
  async function lane() {
    while (next < list.length) {
      const i = next++;
      try { results[i] = { status: 'fulfilled', value: await worker(list[i], i) }; }
      catch (reason) { results[i] = { status: 'rejected', reason }; }
    }
  }
  const lanes = Math.max(1, Math.min(Number(limit) || 1, list.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}
