import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import DialogShell from './DialogShell';
import { LineImage } from './OrderItemsList';
import { callOrdersApi } from '../utils/orderApi';
import { RETURN_REASONS, returnRefundAmount } from '../utils/orderStatus';
import { formatMoney } from '../utils/catalog';
import { fmtDate, lineVariantLabel } from '../utils/orderFormat';

// "Return / replace items": pick lines + quantities, a reason, optional details. `lines` is the
// `lines` array of orderStatus.returnableLines(order, returnedQty), so only what can really still be
// returned is offered (the server re-checks all of it).
//   onRequested(result)  after a successful request, when the dialog is dismissed
export default function ReturnRequestDialog({ order, lines, onClose, onRequested }) {
  const [picked, setPicked] = useState({});               // key -> qty (absent = not selected)
  const [type, setType] = useState('return');
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  const chosen = useMemo(() => lines.filter(l => picked[l.key]).map(l => ({ ...l, qty: picked[l.key] })), [lines, picked]);
  const refund = useMemo(() => returnRefundAmount(order, chosen), [order, chosen]);

  function toggle(l) {
    setPicked(p => { const n = { ...p }; if (n[l.key]) delete n[l.key]; else n[l.key] = 1; return n; });
  }

  async function submit() {
    if (busy) return;
    if (!chosen.length) { setError('Select at least one item.'); return; }
    if (!reason) { setError('Please choose a reason.'); return; }
    setBusy(true); setError('');
    const res = await callOrdersApi('return_request', {
      orderId: order.order_id,
      items: chosen.map(l => ({ variantId: l.variantId, qty: l.qty, reason })),
      reason, details: details.trim(), type,
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    toast.success(type === 'replacement' ? 'Replacement requested.' : 'Return requested.');
    setDone(res);
  }

  function finish() { onClose?.(); if (done) onRequested?.(done); }

  if (done) {
    return (
      <DialogShell title="Request received" onClose={finish} labelId="return-title"
        footer={<button type="button" className="btn btn-gold" onClick={finish}>Done</button>}>
        <div className="dlg-ok">
          <div className="dlg-ok-ico" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg></div>
          <p style={{ margin: '0 0 6px', fontWeight: 500 }}>We have your {type === 'replacement' ? 'replacement' : 'return'} request.</p>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.55 }}>
            Our team will review it and get back to you by email. You can follow its status on this page.
            {type === 'return' && done.return?.refund_amount > 0 && ` If approved, ${formatMoney(done.return.refund_amount)} is refunded once we receive the item.`}
          </p>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell title="Return or replace items" onClose={onClose} busy={busy} labelId="return-title"
      footer={(
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Close</button>
          <button type="button" className="btn btn-gold" onClick={submit} disabled={busy} aria-busy={busy}>
            {busy ? <span className="spinner" role="status" aria-label="Submitting" style={{ width: 18, height: 18, borderWidth: 2 }} /> : 'Submit request'}
          </button>
        </>
      )}>
      {error && <div className="dlg-err" role="alert">{error}</div>}

      <div className="dlg-field">
        <div className="form-label" id="return-items-label">Select items</div>
        <ul className="dlg-lines" aria-labelledby="return-items-label">
          {lines.map(l => (
            <li key={l.key} className="dlg-line">
              <input type="checkbox" id={`ret-${l.key}`} checked={!!picked[l.key]} onChange={() => toggle(l)} aria-label={`Select ${l.name}`} />
              <LineImage item={l} size={100} linked={false} />
              <label htmlFor={`ret-${l.key}`} style={{ flex: 1, minWidth: 0, cursor: 'pointer', fontSize: 13.5, lineHeight: 1.4 }}>
                <span style={{ display: 'block', fontWeight: 500, overflowWrap: 'anywhere' }}>{l.name}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>
                  {[lineVariantLabel(l), formatMoney(l.price), `return by ${fmtDate(l.deadline)}`].filter(Boolean).join(' · ')}
                </span>
              </label>
              {picked[l.key] && l.returnableQty > 1 && (
                <select aria-label={`Quantity of ${l.name}`} className="form-select" value={picked[l.key]} onChange={e => setPicked(p => ({ ...p, [l.key]: Number(e.target.value) }))}>
                  {Array.from({ length: l.returnableQty }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              )}
            </li>
          ))}
        </ul>
      </div>

      <fieldset style={{ border: 'none', margin: 0, padding: 0 }} className="dlg-field">
        <legend className="form-label" style={{ marginBottom: 8 }}>What would you like?</legend>
        {[['return', 'Return for a refund'], ['replacement', 'Replace with the same item']].map(([v, label]) => (
          <label key={v} className="dlg-radio">
            <input type="radio" name="return-type" value={v} checked={type === v} onChange={() => setType(v)} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      <div className="dlg-field">
        <label className="form-label" htmlFor="return-reason">Reason</label>
        <select id="return-reason" className="form-input form-select" value={reason} onChange={e => setReason(e.target.value)}>
          <option value="">Select a reason</option>
          {RETURN_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div className="dlg-field">
        <label className="form-label" htmlFor="return-details">Tell us more (optional)</label>
        <textarea id="return-details" className="form-input form-textarea" rows={3} maxLength={500} value={details} onChange={e => setDetails(e.target.value)} placeholder="What went wrong?" style={{ minHeight: 76 }} />
      </div>

      {type === 'return' && chosen.length > 0 && (
        <div className="dlg-note">Estimated refund: <strong>{formatMoney(refund)}</strong>, after your item is received and checked.</div>
      )}
    </DialogShell>
  );
}
