// Returns the URL unchanged when it is safe to put in an href/src, otherwise ''.
// Allowed: same-site paths ("/shop", "#top"), http(s), mailto and tel. Everything
// else (javascript:, data:, vbscript:, protocol-relative "//host") is dropped, so an
// admin-editable link field can never become a script-execution sink.
export function safeHref(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) return '';
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed;
  try {
    const { protocol } = new URL(trimmed);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(protocol) ? trimmed : '';
  } catch {
    return '';
  }
}

// True for links that stay on this site and should use client-side routing
// instead of a full page reload.
export function isInternalPath(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//');
}
