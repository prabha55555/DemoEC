import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../ui/Modal';

// "You have unsaved changes" protection for forms.
//
//   const dirty = JSON.stringify(form) !== JSON.stringify(saved);
//   useUnsavedChanges(dirty);
//
// While `dirty` is true:
//   * closing / reloading the tab shows the browser's own "Leave site?" prompt, and
//   * clicking any in-app link (sidebar, breadcrumb, buttons that are <Link>s) asks "Discard changes?" first.
// (The browser Back button is not interceptable with this router and goes straight through.)
// Needs <UnsavedChangesProvider> above it -- AdminLayout provides one. Without one the hook does nothing.
const GuardCtx = createContext(null);

export function UnsavedChangesProvider({ children }) {
  const dirtyIds = useRef(new Set());
  const [pending, setPending] = useState(null); // the href waiting for confirmation
  const navigate = useNavigate();

  const setDirty = useCallback((id, dirty) => {
    if (dirty) dirtyIds.current.add(id); else dirtyIds.current.delete(id);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (dirtyIds.current.size === 0) return;
      e.preventDefault();
      e.returnValue = '';
    };
    // Capture phase, on document: runs before React Router's own <Link> handler and can stop it.
    const onClick = (e) => {
      if (dirtyIds.current.size === 0 || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const next = url.pathname + url.search + url.hash;
      if (next === window.location.pathname + window.location.search + window.location.hash) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(next);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  function leave() {
    const to = pending;
    dirtyIds.current.clear();
    setPending(null);
    if (to) navigate(to);
  }

  return (
    <GuardCtx.Provider value={setDirty}>
      {children}
      <ConfirmDialog
        open={!!pending} onClose={() => setPending(null)} onConfirm={leave}
        title="Discard unsaved changes?" message="You have changes that have not been saved. If you leave this page they will be lost."
        confirmLabel="Discard and leave" cancelLabel="Keep editing" tone="danger"
      />
    </GuardCtx.Provider>
  );
}

export default function useUnsavedChanges(dirty) {
  const setDirty = useContext(GuardCtx);
  const id = useId();
  useEffect(() => {
    if (!setDirty) return undefined;
    setDirty(id, !!dirty);
    return () => setDirty(id, false);
  }, [dirty, id, setDirty]);
}
