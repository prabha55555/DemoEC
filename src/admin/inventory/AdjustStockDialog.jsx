import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Field, FieldRow, Modal, NumberInput, Select, Textarea, Thumb } from '../ui';
import { callAdjustStock } from '../products/productApi';
import { ADJUST_REASONS, planAdjustment, planBulk, signed } from './inventoryLogic';

// "Adjust stock": Add / Remove / Set exact + a quantity, a reason and a note. Every change goes through the
// admin_adjust_stock function (atomic, and written to the stock ledger with who did it); "Add" and "Remove" are
// relative, so they never overwrite a sale that landed a moment earlier. One dialog serves a single variant
// (`rows` has one entry) and the bulk "Set stock…" (several).
const MODES = [{ key: 'add', label: 'Add' }, { key: 'remove', label: 'Remove' }, { key: 'set', label: 'Set exact' }];
const DEFAULT_REASON = { add: 'restock', remove: 'damaged', set: 'recount' };

// rows: [{ id, label, sku, stock, track_inventory, productName, image }]
export default function AdjustStockDialog({ rows, onClose, onDone }) {
  const open = !!rows && rows.length > 0;
  const bulk = open && rows.length > 1;
  const [mode, setMode] = useState('add');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState(DEFAULT_REASON.add);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);

  useEffect(() => { if (open) { setMode('add'); setQty(''); setReason(DEFAULT_REASON.add); setNote(''); setBusy(false); setError(''); setReasonTouched(false); } }, [open]);
  const pick = (m) => { setMode(m); setError(''); if (!reasonTouched) setReason(DEFAULT_REASON[m]); };

  const one = open && !bulk ? rows[0] : null;
  const single = useMemo(() => (one ? planAdjustment({ mode, qty, current: one.stock }) : null), [one, mode, qty]);
  const bulkPlan = useMemo(() => (bulk ? planBulk({ mode, qty, rows }) : null), [bulk, mode, qty, rows]);
  const typed = String(qty).trim() !== '';

  async function submit() {
    setError('');
    if (!open) return;
    const trimmed = note.trim() || null;
    if (!bulk) {
      if (!single.ok) { setError(single.error); return; }
      setBusy(true);
      const r = await callAdjustStock({ variantId: one.id, ...(single.args.p_delta !== undefined ? { delta: single.args.p_delta } : { setTo: single.args.p_set_to }), reason, note: trimmed });
      setBusy(false);
      if (!r.ok) { setError(r.error); return; }
      toast.success(`${one.productName ? `${one.productName} · ` : ''}${one.label}: stock is now ${r.stock}.`);
      onDone();
      onClose();
      return;
    }
    if (!bulkPlan.plan.length) { setError(typed ? 'None of the selected variants would change.' : 'Enter a quantity.'); return; }
    setBusy(true);
    let ok = 0;
    const failed = [];
    for (const p of bulkPlan.plan) {
      // eslint-disable-next-line
      const r = await callAdjustStock({ variantId: p.row.id, ...(p.args.p_delta !== undefined ? { delta: p.args.p_delta } : { setTo: p.args.p_set_to }), reason, note: trimmed });
      if (r.ok) ok += 1; else failed.push(`${p.row.productName || ''} ${p.row.label}: ${r.error}`.trim());
    }
    setBusy(false);
    if (failed.length) { setError(`${ok} updated, ${failed.length} failed. ${failed.slice(0, 3).join(' ')}`); if (ok) onDone(); return; }
    toast.success(`Stock updated on ${ok} variant${ok === 1 ? '' : 's'}.`);
    onDone();
    onClose();
  }

  const untrackedOnly = open && !bulk && one.track_inventory === false;
  const title = bulk ? `Set stock for ${rows.length} variants` : 'Adjust stock';
  const resulting = !bulk && single?.ok ? single.resulting : null;

  return (
    <Modal open={open} onClose={onClose} busy={busy} title={title}
      subtitle={bulk ? 'The same change is applied to each selected variant.' : undefined}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit} disabled={untrackedOnly || (!bulk && !typed)}>
            {bulk ? `Apply to ${bulkPlan.plan.length || rows.length} variant${(bulkPlan.plan.length || rows.length) === 1 ? '' : 's'}` : 'Save adjustment'}
          </Button>
        </>
      )}>
      {open && (
        <div className="adm-stack">
          {!bulk && (
            <div className="iv-target">
              <Thumb src={one.image} width={96} size={44} />
              <div>
                <strong>{one.productName || 'Product'}</strong>
                <div className="adm-cell-sub">{one.label}{one.sku ? ` · ${one.sku}` : ''}</div>
              </div>
              <div className="iv-current"><span className="adm-cell-sub">In stock now</span><b>{one.track_inventory === false ? '∞' : one.stock}</b></div>
            </div>
          )}
          {bulk && (
            <ul className="iv-targets" aria-label="Selected variants">
              {rows.slice(0, 6).map(r => <li key={r.id}><span>{r.productName ? `${r.productName} · ` : ''}{r.label}</span><span className="adm-muted">{r.track_inventory === false ? 'Unlimited' : `${r.stock} now`}</span></li>)}
              {rows.length > 6 && <li className="adm-muted">…and {rows.length - 6} more</li>}
            </ul>
          )}
          {untrackedOnly ? (
            <div className="adm-note info">This variant does not track stock (it never sells out). Turn on “Track inventory” in the product form to manage its stock here.</div>
          ) : (
            <>
              <div className="adm-seg iv-modes" role="group" aria-label="Type of adjustment">
                {MODES.map(m => <button key={m.key} type="button" aria-pressed={mode === m.key} onClick={() => pick(m.key)}>{m.label}</button>)}
              </div>
              <FieldRow cols={2}>
                <Field label={mode === 'set' ? 'New stock level' : mode === 'add' ? 'Units to add' : 'Units to remove'} required
                  hint={!bulk && resulting !== null ? <span>Stock will be <strong>{resulting}</strong> ({signed(single.delta)})</span> : undefined}>
                  <NumberInput integer value={qty} onChange={v => { setQty(v); setError(''); }} placeholder="0" suffix="units" autoFocus />
                </Field>
                <Field label="Reason">
                  <Select value={reason} onChange={v => { setReason(v); setReasonTouched(true); }} options={ADJUST_REASONS} />
                </Field>
              </FieldRow>
              {!bulk && typed && !single.ok && <div className="adm-error" role="alert">{single.error}</div>}
              {bulk && typed && bulkPlan.skipped.length > 0 && (
                <div className="adm-hint">{bulkPlan.skipped.length} will be skipped: {bulkPlan.skipped.slice(0, 3).map(s => `${s.row.label} (${s.reason.toLowerCase()})`).join(', ')}{bulkPlan.skipped.length > 3 ? '…' : ''}</div>
              )}
              <Field label="Note" optional hint="Shown in the stock ledger, e.g. a supplier invoice number.">
                <Textarea rows={2} value={note} onChange={setNote} maxLength={200} />
              </Field>
            </>
          )}
          {error && <div className="adm-error" role="alert">{error}</div>}
        </div>
      )}
    </Modal>
  );
}
