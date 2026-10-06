import { useEffect } from 'react';

// Closes a popover: a click outside `ref`, or Escape. Escape also calls `onEscape` first so the caller can
// return focus to the control that opened the popover.
//   useDismiss(wrapRef, open, () => setOpen(false));
export default function useDismiss(ref, open, onClose, onEscape) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') { if (onEscape) onEscape(); onClose(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, onClose, onEscape]);
}
