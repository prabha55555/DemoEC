import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../supabase';
import { normalizeAddresses, removeAddress, setDefaultAddress, sortAddresses, upsertAddress } from '../utils/addressBook';
import { isValidIndianMobile } from '../utils/orderFormat';
import AddressForm from './AddressForm';
import { EmptyState, NavIcon, TabHead } from './AccountParts';

const EMPTY = { name: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '', type: '' };

// Account -> Addresses. profiles.addresses (jsonb) is the storage; every entry has a stable id, one is the
// default, and saving the same line1 + PIN code again updates the entry instead of duplicating it.
export default function AccountAddressesTab({ userProfile, currentUser, refreshProfile }) {
  const addresses = useMemo(() => sortAddresses(normalizeAddresses(userProfile?.addresses)), [userProfile?.addresses]);
  const [form, setForm] = useState({ ...EMPTY });
  const [errors, setErrors] = useState({});
  const [editingId, setEditingId] = useState(null); // null = adding
  const [makeDefault, setMakeDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState(null); // two-step delete: first tap arms, second tap deletes

  useEffect(() => {
    if (!confirmId) return undefined;
    const t = setTimeout(() => setConfirmId(null), 4000);
    return () => clearTimeout(t);
  }, [confirmId]);

  // One address-list write at a time: every write is computed from the list the customer is looking at.
  async function persist(next, okMessage) {
    setBusy(true);
    try {
      const { error } = await supabase.from('profiles').update({ addresses: next }).eq('id', currentUser.id);
      if (error) throw error;
      await refreshProfile();
      if (okMessage) toast.success(okMessage);
      return true;
    } catch {
      toast.error('Could not save your addresses. Please try again.');
      return false;
    } finally { setBusy(false); }
  }

  function patch(p) {
    setForm(f => ({ ...f, ...p }));
    setErrors(e => { const n = { ...e }; Object.keys(p).forEach(k => { n[k] = ''; }); return n; });
  }

  function startEdit(a) {
    setEditingId(a.id);
    setForm({ ...EMPTY, ...a });
    setMakeDefault(false);
    setErrors({});
    requestAnimationFrame(() => document.getElementById('addr-name')?.focus());
  }

  function reset() { setEditingId(null); setForm({ ...EMPTY }); setErrors({}); setMakeDefault(false); }

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = 'Required';
    if (!form.phone.trim()) e.phone = 'Required';
    else if (!isValidIndianMobile(form.phone)) e.phone = 'Enter a valid 10-digit mobile number';
    if (!form.pincode.trim()) e.pincode = 'Required';
    else if (!/^\d{6}$/.test(form.pincode.trim())) e.pincode = 'Enter a valid 6-digit PIN code';
    if (!form.city.trim()) e.city = 'Required';
    if (!form.state.trim()) e.state = 'Required';
    if (!form.line1.trim()) e.line1 = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (busy) return;
    if (!validate()) { toast.error('Please fix the highlighted fields.'); return; }
    const { addresses: next } = upsertAddress(addresses, form, { id: editingId, makeDefault: makeDefault || (editingId === null && addresses.length === 0) });
    const wasEditing = editingId !== null;
    if (await persist(next, wasEditing ? 'Address updated.' : 'Address saved.')) reset();
  }

  async function makeDefaultOf(a) {
    if (busy || a.isDefault) return;
    await persist(setDefaultAddress(addresses, a.id), 'Default address changed.');
  }

  async function remove(a) {
    if (busy) return;
    if (confirmId !== a.id) { setConfirmId(a.id); return; }
    setConfirmId(null);
    if (await persist(removeAddress(addresses, a.id), 'Address removed.') && editingId === a.id) reset();
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <TabHead title="My addresses" sub="Your default address is preselected at checkout." />
      {addresses.length === 0 ? (
        <div style={{ marginBottom: 16 }}>
          <EmptyState art="addresses" title="No saved addresses yet" text="Add your delivery address below and checkout gets faster." />
        </div>
      ) : (
        <div className="acc-addrs">
          {addresses.map(a => (
            <div key={a.id} className={`acc-addr${editingId === a.id ? ' is-editing' : ''}`}>
              <div className="acc-addr-top">
                <span className="acc-addr-pin" aria-hidden="true"><NavIcon name="addresses" size={18} /></span>
                {a.type && <span className="badge badge-sold">{a.type}</span>}
                {a.isDefault && <span className="badge badge-gold">Default</span>}
                {editingId === a.id && <span className="badge badge-confirmed">Editing</span>}
              </div>
              <div className="acc-addr-body">
                <strong>{a.name}</strong>{a.phone}<br />
                {[a.line1, a.line2].filter(Boolean).join(', ')}<br />
                {a.city}, {a.state}, {a.pincode}
              </div>
              <div className="acc-addr-actions">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => startEdit(a)} disabled={busy}>Edit</button>
                {!a.isDefault && <button type="button" className="btn btn-outline btn-sm" onClick={() => makeDefaultOf(a)} disabled={busy}>Set as default</button>}
                <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(a)} disabled={busy}>{confirmId === a.id ? 'Tap again to delete' : 'Delete'}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="acc-card acc-form-card">
        <div className="acc-formhead">
          <h3 className="acc-h" style={{ fontSize: 18 }}>{editingId === null ? 'Add new address' : 'Edit address'}</h3>
          {editingId !== null && <button type="button" onClick={reset} disabled={busy} className="acc-link acc-linkbtn">Cancel</button>}
        </div>
        <AddressForm value={form} onChange={patch} errors={errors} idPrefix="addr" fields={{ type: true }} disabled={busy} />
        {addresses.length > 0 && !(editingId && addresses.find(a => a.id === editingId)?.isDefault) && (
          <label className="acc-check" style={{ marginTop: 14 }}>
            <input type="checkbox" checked={makeDefault} onChange={e => setMakeDefault(e.target.checked)} />
            <span>Make this my default address</span>
          </label>
        )}
        <button type="button" className="btn btn-gold" style={{ marginTop: 18 }} onClick={save} disabled={busy} aria-busy={busy}>
          {busy ? <span className="spinner" role="status" aria-label="Saving" /> : editingId === null ? 'Save address' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
