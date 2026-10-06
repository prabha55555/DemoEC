import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabase';
import { withTimeout } from '../../utils/withTimeout';
import { Button, ErrorState, Modal, NumberInput, Skeleton, Thumb } from '../ui';
import { callAdjustStock } from '../products/productApi';

// "Out of stock" quick restock: every tracked, active variant that has run out, with a quantity box each. Type how many
// arrived and apply: each becomes a "Received stock" movement in the ledger. Shows the first 40; apply, then reopen for more.
const PAGE = 40;

export default function QuickRestockDialog({ open, onClose, onDone }) {
  const [state, setState] = useState({ loading: true, error: null, rows: [], total: 0 });
  const [qty, setQty] = useState({});
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));
    setQty({}); setProblems([]);
    (async () => {
      try {
        const { data, error, count } = await withTimeout(supabase.from('product_variants').select('id, product_id, label, sku, stock', { count: 'exact' })
          .eq('active', true).eq('track_inventory', true).eq('stock', 0).order('product_id').order('position').range(0, PAGE - 1), 20000);
        if (error) throw error;
        const ids = Array.from(new Set((data || []).map(v => v.product_id)));
        const names = new Map();
        if (ids.length) {
          const { data: ps } = await withTimeout(supabase.from('products').select('id, name, images').in('id', ids), 15000);
          (ps || []).forEach(p => names.set(p.id, p));
        }
        if (!cancelled) setState({ loading: false, error: null, total: count ?? (data || []).length, rows: (data || []).map(v => ({ ...v, productName: names.get(v.product_id)?.name || 'Product', image: names.get(v.product_id)?.images?.[0] })) });
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: { message: e?.message || 'Could not load the out-of-stock variants.' }, rows: [], total: 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [open, nonce]);

  const todo = state.rows.filter(r => /^\d+$/.test(String(qty[r.id] ?? '').trim()) && Number(qty[r.id]) > 0);

  async function apply() {
    setBusy(true);
    setProblems([]);
    let ok = 0;
    const bad = [];
    for (const r of todo) {
      // eslint-disable-next-line
      const res = await callAdjustStock({ variantId: r.id, delta: Number(qty[r.id]), reason: 'restock', note: 'Quick restock' });
      if (res.ok) ok += 1; else bad.push(`${r.productName} · ${r.label}: ${res.error}`);
    }
    setBusy(false);
    if (ok) { toast.success(`Restocked ${ok} variant${ok === 1 ? '' : 's'}.`); onDone(); }
    if (bad.length) setProblems(bad);
    else { onClose(); }
    if (bad.length && ok) setNonce(n => n + 1);
  }

  return (
    <Modal open={open} onClose={onClose} busy={busy} size="lg" title="Restock out-of-stock items"
      subtitle={state.total ? `${state.total.toLocaleString('en-IN')} variant${state.total === 1 ? ' is' : 's are'} out of stock. Enter the quantity that arrived for each.` : 'Variants that have run out appear here.'}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Close</Button>
          <Button variant="primary" loading={busy} disabled={todo.length === 0} onClick={apply}>Restock {todo.length || ''} variant{todo.length === 1 ? '' : 's'}</Button>
        </>
      )}>
      {state.loading ? <div className="adm-stack"><Skeleton height={44} /><Skeleton height={44} /><Skeleton height={44} /></div>
        : state.error ? <ErrorState error={state.error} onRetry={() => setNonce(n => n + 1)} compact />
          : state.rows.length === 0 ? <p className="adm-muted" style={{ textAlign: 'center', padding: '24px 0' }}>Nothing is out of stock. Nice.</p>
            : (
              <ul className="iv-restock">
                {state.rows.map(r => (
                  <li key={r.id}>
                    <Thumb src={r.image} width={80} size={38} />
                    <div className="iv-restock-name"><strong>{r.productName}</strong><span className="adm-cell-sub">{r.label}{r.sku ? ` · ${r.sku}` : ''}</span></div>
                    <div className="iv-restock-qty"><NumberInput integer value={qty[r.id] ?? ''} onChange={v => setQty(q => ({ ...q, [r.id]: v }))} placeholder="0" suffix="units" aria-label={`Units received for ${r.productName} ${r.label}`} /></div>
                  </li>
                ))}
                {state.total > state.rows.length && <li className="adm-muted">…and {state.total - state.rows.length} more. Restock these, then open this again.</li>}
              </ul>
            )}
      {problems.length > 0 && <div className="adm-error" role="alert" style={{ marginTop: 10 }}>{problems.slice(0, 4).join(' ')}</div>}
    </Modal>
  );
}
