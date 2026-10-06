import { useEffect, useState } from 'react';

// True while the viewport matches `query` (e.g. '(max-width: 899px)'). Safe where matchMedia is missing.
export function useMediaQuery(query) {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export const useIsMobile = (bp = 899) => useMediaQuery(`(max-width: ${bp}px)`);
