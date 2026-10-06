import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

// Filter / search / page state kept in the URL query string, so a filtered list can be bookmarked, shared,
// reloaded and linked to from elsewhere (the dashboard tiles link to /admin/orders?status=Placed,Confirmed,Packed).
//
//   const { values, set, reset, active } = useUrlFilters({ q: '', status: '', page: 1 });
//   set({ status: 'Placed' });          // any change other than `page` also resets page to 1
//   useServerList({ …, filters: { status: values.status ? values.status.split(',') : '' },
//                   search: values.q, page: values.page, onPageChange: p => set({ page: p }) });
//
// Defaults are not written to the URL (a clean /admin/orders means "no filters"). A numeric default (page)
// is read back as a number. Changes use history `replace`, so filtering never fills the back-button history.
export default function useUrlFilters(defaults) {
  const [params, setParams] = useSearchParams();
  const defaultsKey = JSON.stringify(defaults);

  const values = useMemo(() => {
    const d = JSON.parse(defaultsKey);
    const out = {};
    for (const key of Object.keys(d)) {
      const raw = params.get(key);
      if (raw === null) out[key] = d[key];
      else if (typeof d[key] === 'number') { const n = Number(raw); out[key] = Number.isFinite(n) && n > 0 ? Math.floor(n) : d[key]; }
      else out[key] = raw;
    }
    return out;
  }, [params, defaultsKey]);

  const set = useCallback((patch) => {
    const d = JSON.parse(defaultsKey);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(patch)) {
        if (!(key in d)) continue;
        if (value === undefined || value === null || value === '' || String(value) === String(d[key])) next.delete(key);
        else next.set(key, String(value));
      }
      // Any filter change (anything but page itself) goes back to page 1.
      if (Object.keys(patch).some(k => k !== 'page') && !('page' in patch)) next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams, defaultsKey]);

  const reset = useCallback(() => {
    const d = JSON.parse(defaultsKey);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const key of Object.keys(d)) next.delete(key);
      return next;
    }, { replace: true });
  }, [setParams, defaultsKey]);

  // True when any non-page value differs from its default -- drives the FilterBar's "Clear" button.
  const active = useMemo(() => {
    const d = JSON.parse(defaultsKey);
    return Object.keys(d).some(k => k !== 'page' && String(values[k]) !== String(d[k]));
  }, [values, defaultsKey]);

  return { values, set, reset, active };
}
