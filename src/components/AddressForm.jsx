import React, { useRef, useState } from 'react';
import { INDIAN_STATES, lookupPincode } from '../utils/indianAddress';
import './orderUi.css';

// One address form for checkout (shipping / billing) and the Account address book. Controlled:
// `value` is { name, phone, [email], line1, line2, city, state, pincode, [type] } and every change is
// reported as a partial object -- onChange({ city, state }) after a PIN lookup, onChange({ name }) when typing.
// Field ids are `${idPrefix}-<key>` (ship-name, ship-line1 ...) so labels and tests can find them.
//
//   fields.email   show the contact-email field (mobile-OTP customers have no usable account email)
//   fields.phone   'required' (default) | 'optional' | false
//   fields.type    show the optional Home / Work / Other chooser
//   errors         { key: message }
const AUTOCOMPLETE = { name: 'name', phone: 'tel', email: 'email', pincode: 'postal-code', city: 'address-level2', state: 'address-level1', line1: 'address-line1', line2: 'address-line2' };

export default function AddressForm({ value, onChange, errors = {}, idPrefix = 'addr', fields = {}, disabled = false }) {
  const v = value || {};
  const [looking, setLooking] = useState(false);
  const latestPin = useRef('');

  const phoneMode = fields.phone === false ? false : (fields.phone || 'required');
  const req = (on) => (on ? ' *' : '');

  function onPincode(raw) {
    const pin = raw.replace(/\D/g, '').slice(0, 6);
    onChange({ pincode: pin });
    if (/^\d{6}$/.test(pin) && pin !== latestPin.current) {
      latestPin.current = pin;
      setLooking(true);
      lookupPincode(pin).then(loc => {
        if (latestPin.current !== pin) return; // a newer PIN was typed meanwhile
        if (loc) onChange({ city: loc.city, state: loc.state });
      }).catch(() => {}).finally(() => { if (latestPin.current === pin) setLooking(false); });
    }
  }

  const field = (key, label, { type = 'text', required = true, full = false, inputMode, maxLength } = {}) => {
    const id = `${idPrefix}-${key}`;
    const err = errors[key];
    return (
      <div key={key} style={full ? { gridColumn: '1 / -1' } : undefined}>
        <label className="form-label" htmlFor={id}>{label}{req(required)}</label>
        {key === 'state' ? (
          <select id={id} className="form-input form-select" value={v.state || ''} disabled={disabled}
            onChange={e => onChange({ state: e.target.value })} autoComplete={AUTOCOMPLETE.state}
            aria-invalid={err ? 'true' : undefined} aria-describedby={err ? `${id}-err` : undefined}
            style={{ cursor: 'pointer', ...(err ? { borderColor: 'var(--error)' } : null) }}>
            <option value="">Select state</option>
            {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <input id={id} className="form-input" type={type} value={v[key] || ''} disabled={disabled}
            onChange={e => (key === 'pincode' ? onPincode(e.target.value) : onChange({ [key]: e.target.value }))}
            autoComplete={AUTOCOMPLETE[key]} inputMode={inputMode} maxLength={maxLength}
            autoCapitalize={key === 'email' ? 'none' : undefined} spellCheck={key === 'email' ? false : undefined}
            aria-invalid={err ? 'true' : undefined} aria-describedby={err ? `${id}-err` : undefined}
            style={err ? { borderColor: 'var(--error)' } : undefined} />
        )}
        {err && <div className="form-error" id={`${id}-err`} role="alert">{err}</div>}
      </div>
    );
  };

  return (
    <div className="adf-grid">
      {field('name', 'Full name', { full: !phoneMode })}
      {phoneMode && field('phone', 'Mobile number', { type: 'tel', inputMode: 'tel', required: phoneMode === 'required', maxLength: 15 })}
      {fields.email && field('email', 'Email', { type: 'email', inputMode: 'email', full: true })}
      {field('pincode', 'PIN code', { inputMode: 'numeric', maxLength: 6 })}
      {field('city', 'City')}
      <div className="adf-lookup" aria-live="polite">{looking ? 'Looking up your city and state…' : ''}</div>
      {field('state', 'State', { full: !fields.type })}
      {fields.type && (
        <div>
          <label className="form-label" htmlFor={`${idPrefix}-type`}>Address type (optional)</label>
          <select id={`${idPrefix}-type`} className="form-input form-select" value={v.type || ''} disabled={disabled} onChange={e => onChange({ type: e.target.value })} style={{ cursor: 'pointer' }}>
            <option value="">Not specified</option>
            <option value="Home">Home</option>
            <option value="Work">Work</option>
            <option value="Other">Other</option>
          </select>
        </div>
      )}
      {field('line1', 'Address (house no., building, street)', { full: true })}
      {field('line2', 'Landmark / area (optional)', { required: false, full: true })}
    </div>
  );
}
