import { useEffect } from 'react';

// Sets the browser tab title to "<title> · Admin" while the component is mounted, then puts the previous
// title back. Pass a falsy title to leave it alone (e.g. while the record's name is still loading).
export default function useDocumentTitle(title) {
  useEffect(() => {
    if (!title) return undefined;
    const previous = document.title;
    document.title = `${title} · Admin`;
    return () => { document.title = previous; };
  }, [title]);
}
