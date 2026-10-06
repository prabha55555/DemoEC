import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Button from './Button';
import Icon from './Icon';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Several dialogs can be open at once (a confirm on top of an editor): only the last one scrolls-locks the page,
// and the page scrolls again when the last one closes.
let openCount = 0;

// A modal dialog: focus moves in and is trapped, Escape and a click on the backdrop close it (unless
// `busy` or dismissable={false}), focus returns to what opened it, and the page behind does not scroll.
//
//   <Modal open={open} onClose={() => setOpen(false)} title="Edit address" footer={<Button variant="primary">Save</Button>}>
//     …content…
//   </Modal>
// size: 'sm' | 'md' (default) | 'lg'.  role="alertdialog" for destructive confirmations.
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', dismissable = true, busy = false, role = 'dialog', initialFocus }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const canClose = dismissable && !busy;

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    openCount += 1;
    document.body.style.overflow = 'hidden';
    // Focus the requested control, else the first focusable inside the body, else the dialog itself.
    const t = setTimeout(() => {
      const root = dialogRef.current;
      if (!root) return;
      const target = (initialFocus && root.querySelector(initialFocus))
        || root.querySelector('.adm-modal-body input, .adm-modal-body select, .adm-modal-body textarea')
        || root.querySelector('.adm-modal-foot .primary, .adm-modal-foot button')
        || root;
      target.focus();
    }, 0);
    return () => {
      clearTimeout(t);
      openCount -= 1;
      if (openCount <= 0) { openCount = 0; document.body.style.overflow = ''; }
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
  // Focus is set once per open, not on every prop change, so initialFocus is intentionally not a dependency.
  // eslint-disable-next-line
  }, [open]);

  // An error banner (role="alert") that appears below the fold of a scrolling dialog would go unnoticed, so each NEW
  // message is brought into view once. A re-render that leaves the message unchanged does not move the scroll again.
  useEffect(() => {
    if (!open || typeof MutationObserver === 'undefined') return undefined;
    const root = dialogRef.current;
    if (!root) return undefined;
    let shown = '';
    const mo = new MutationObserver(() => {
      const el = root.querySelector('.adm-modal-body [role="alert"]');
      const text = el ? el.textContent : '';
      if (text && text !== shown && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
      shown = text;
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [open]);

  if (!open) return null;

  function onKeyDown(e) {
    if (e.key === 'Escape' && canClose) { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    // Only controls the user can actually reach: a `hidden` file input or anything inside a display:none block has no
    // client rects, and trapping focus on it would let Tab escape the dialog.
    const items = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE)).filter(el => !el.hidden && (el.getClientRects().length > 0 || el === document.activeElement));
    if (items.length === 0) { e.preventDefault(); dialogRef.current.focus(); return; }
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // Portalled to <body> inside an `.adm` wrapper so the admin's tokens and fonts still apply, and so no
  // overflow / stacking context of the page can clip it.
  return createPortal(
    <div className="adm adm-portal">
      <div className="adm-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && canClose) onClose(); }}>
        <div
          ref={dialogRef} className={`adm-modal ${size}`} role={role} aria-modal="true" aria-labelledby={title ? titleId : undefined}
          tabIndex={-1} onKeyDown={onKeyDown}
        >
          {(title || canClose) && (
            <header className="adm-modal-head">
              <div>
                {title && <h2 id={titleId} className="adm-modal-title">{title}</h2>}
                {subtitle && <p className="adm-modal-sub">{subtitle}</p>}
              </div>
              {canClose && <button type="button" className="adm-modal-x" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>}
            </header>
          )}
          <div className="adm-modal-body">{children}</div>
          {footer && <footer className="adm-modal-foot">{footer}</footer>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// A yes / no question with an async "yes". onConfirm may return a promise: the confirm button shows a spinner
// and the dialog stays open until it settles. Resolving to `false`, or throwing, keeps it open (a thrown
// message is shown in the dialog); anything else closes it via onClose.
//
//   <ConfirmDialog open={!!target} onClose={() => setTarget(null)} title="Delete this coupon?"
//     message="Customers will no longer be able to use it." confirmLabel="Delete" tone="danger"
//     onConfirm={async () => { const { ok } = await adminWrite(…); return ok; }} />
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'primary', children }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!open) { setBusy(false); setError(''); } }, [open]);

  async function confirm() {
    setBusy(true); setError('');
    try {
      const result = await onConfirm();
      if (!mounted.current) return;
      setBusy(false);
      if (result !== false) onClose();
    } catch (e) {
      if (!mounted.current) return;
      setBusy(false);
      setError(e?.message || 'Something went wrong.');
    }
  }

  return (
    <Modal
      open={open} onClose={onClose} title={title} size="sm" busy={busy} role={tone === 'danger' ? 'alertdialog' : 'dialog'}
      initialFocus=".adm-modal-foot button:first-child"
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>{cancelLabel}</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={confirm}>{confirmLabel}</Button>
        </>
      )}
    >
      {message && <p className="adm-modal-text">{message}</p>}
      {children}
      {error && <p className="adm-error" role="alert">{error}</p>}
    </Modal>
  );
}

// Promise-based confirm for handlers, instead of window.confirm():
//   const confirm = useConfirm();
//   if (!(await confirm({ title: 'Delete this post?', message: 'This cannot be undone.', confirmLabel: 'Delete', tone: 'danger' }))) return;
// Needs <ConfirmProvider> above it (AdminLayout provides one). Resolves true on confirm, false on cancel / Escape.
const ConfirmCtx = createContext(null);

export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null);
  const confirm = useCallback((opts) => new Promise(resolve => setReq({ ...opts, resolve })), []);
  const done = (value) => { if (req) req.resolve(value); setReq(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={!!req} onClose={() => done(false)} onConfirm={() => done(true)}
        title={req?.title || 'Are you sure?'} message={req?.message} confirmLabel={req?.confirmLabel || 'Confirm'}
        cancelLabel={req?.cancelLabel || 'Cancel'} tone={req?.tone || 'primary'}
      />
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmCtx);
  if (!confirm) throw new Error('useConfirm needs <ConfirmProvider> (AdminLayout provides one).');
  return confirm;
}

export default Modal;
