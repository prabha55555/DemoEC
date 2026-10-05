// Races a promise against a timeout so an await can never hang forever -- a plain
// fetch (which supabase-js calls sit on top of) has no built-in timeout, so a
// stalled connection (dropped mid-request, no error, no response) leaves an await
// pending indefinitely. Used to guard the two startup fetches (brand settings,
// auth session) that gate full-page loading screens -- a hang there used to mean
// the entire site stayed invisible behind the splash/spinner forever, with a
// manual refresh as the only way out.
export function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), ms)),
  ]);
}
