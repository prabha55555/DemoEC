import { useEffect, useState } from 'react';

// The value, delayed: it only changes after `delay` ms with no further change. For a search box:
//   const q = useDebounce(text, 300);   // query with q, not text
export default function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
