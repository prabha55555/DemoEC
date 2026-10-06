import React, { useEffect, useRef } from 'react';
import './orderUi.css';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Accessible modal used by the cancel / return dialogs: focus moves in, Tab stays inside, Escape and a
// click on the backdrop close it (unless `busy`), focus returns to what opened it, the page behind
// does not scroll.
export default function DialogShell({ title, onClose, busy = false, children, footer, labelId = 'dlg-title' }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const opener = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const el = ref.current;
    const first = el?.querySelector('input, select, textarea') || el?.querySelector(FOCUSABLE);
    (first || el)?.focus();

    function onKey(e) {
      if (e.key === 'Escape' && !busyRef.current) { e.stopPropagation(); closeRef.current?.(); return; }
      if (e.key !== 'Tab' || !el) return;
      const nodes = [...el.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null);
      if (!nodes.length) { e.preventDefault(); return; }
      const firstN = nodes[0], lastN = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === firstN) { e.preventDefault(); lastN.focus(); }
      else if (!e.shiftKey && document.activeElement === lastN) { e.preventDefault(); firstN.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, []);

  return (
    <div className="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}>
      <div className="dlg" role="dialog" aria-modal="true" aria-labelledby={labelId} ref={ref} tabIndex={-1}>
        <div className="dlg-head">
          <h2 className="dlg-title" id={labelId}>{title}</h2>
          <button type="button" className="dlg-x" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        <div className="dlg-body">{children}</div>
        {footer && <div className="dlg-foot">{footer}</div>}
      </div>
    </div>
  );
}
