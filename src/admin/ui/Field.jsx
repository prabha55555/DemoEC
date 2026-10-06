import React, { createContext, useContext, useId } from 'react';
import { sanitizeDecimal } from '../lib/format';

// Form controls with a shared contract:
//   * every control calls onChange(VALUE) -- the new value itself, not the DOM event (Toggle/Checkbox: a boolean)
//   * text-like controls keep their value as a STRING (so "1." or "" survive typing); convert on save with
//     parseNumber() from lib/format, and validate with checkNumber() from lib/validate
//   * wrap a control in <Field> to get a label, hint and inline error wired up with the right ids / aria
//
//   <Field label="Cash on delivery fee" hint="Added to the order total." error={errors.cod_fee}>
//     <MoneyInput value={form.cod_fee} onChange={v => set('cod_fee', v)} />
//   </Field>
const FieldCtx = createContext(null);

export function Field({ label, hint, error, required = false, optional = false, children, className = '', htmlFor }) {
  const uid = useId();
  const id = htmlFor || `f${uid.replace(/:/g, '')}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const ctx = { id, describedBy: [errId, hintId].filter(Boolean).join(' ') || undefined, invalid: !!error, required };
  return (
    <div className={`adm-field${error ? ' has-error' : ''} ${className}`.trim()}>
      {label && (
        <label className="adm-label" htmlFor={id}>
          {label}
          {required && <span className="adm-req" aria-hidden="true"> *</span>}
          {optional && <span className="adm-opt"> optional</span>}
        </label>
      )}
      <FieldCtx.Provider value={ctx}>{children}</FieldCtx.Provider>
      {hint && <div id={hintId} className="adm-hint">{hint}</div>}
      {error && <div id={errId} className="adm-error" role="alert">{error}</div>}
    </div>
  );
}

// Merges the surrounding <Field>'s id / aria wiring into a control's own props.
function useControl(props) {
  const f = useContext(FieldCtx);
  return {
    id: props.id || f?.id,
    'aria-describedby': props['aria-describedby'] || f?.describedBy,
    'aria-invalid': props.invalid || f?.invalid ? true : undefined,
    required: props.required ?? f?.required ? true : undefined,
  };
}

function Wrap({ prefix, suffix, invalid, disabled, children }) {
  if (!prefix && !suffix) return children;
  return (
    <div className={`adm-input-wrap${invalid ? ' is-invalid' : ''}${disabled ? ' is-disabled' : ''}`}>
      {prefix && <span className="adm-input-affix pre">{prefix}</span>}
      {children}
      {suffix && <span className="adm-input-affix post">{suffix}</span>}
    </div>
  );
}

// A single-line text box. onChange(value). prefix / suffix show a fixed unit (₹, days, %).
// type: 'text' (default) | 'email' | 'url' | 'tel' | 'password' | 'search' | 'date'
export const TextInput = React.forwardRef(function TextInput({ value, onChange, prefix, suffix, invalid, className = '', type = 'text', ...rest }, ref) {
  const c = useControl({ ...rest, invalid });
  const inner = (
    <input
      ref={ref} type={type} value={value ?? ''} onChange={e => onChange && onChange(e.target.value)}
      className={`adm-input${prefix || suffix ? ' bare' : ''} ${className}`.trim()} {...rest} {...c}
    />
  );
  return <Wrap prefix={prefix} suffix={suffix} invalid={c['aria-invalid']} disabled={rest.disabled}>{inner}</Wrap>;
});

// A multi-line text box. onChange(value). showCount + maxLength shows "12 / 120".
export function Textarea({ value, onChange, rows = 3, showCount = false, invalid, className = '', ...rest }) {
  const c = useControl({ ...rest, invalid });
  const len = String(value ?? '').length;
  return (
    <>
      <textarea
        rows={rows} value={value ?? ''} onChange={e => onChange && onChange(e.target.value)}
        className={`adm-input adm-textarea ${className}`.trim()} {...rest} {...c}
      />
      {showCount && rest.maxLength && <div className="adm-count" aria-hidden="true">{len} / {rest.maxLength}</div>}
    </>
  );
}

// A dropdown. options: [{ value, label, disabled? }] or plain strings. onChange(value).
//   <Select value={status} onChange={setStatus} options={['All', 'Placed']} />
//   placeholder adds a first, empty "Choose…" option.
export function Select({ value, onChange, options = [], placeholder, invalid, className = '', children, ...rest }) {
  const c = useControl({ ...rest, invalid });
  return (
    <div className="adm-select-wrap">
      <select
        value={value ?? ''} onChange={e => onChange && onChange(e.target.value)}
        className={`adm-input adm-select ${className}`.trim()} {...rest} {...c}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(o => {
          const opt = typeof o === 'object' ? o : { value: o, label: o };
          return <option key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</option>;
        })}
        {children}
      </select>
    </div>
  );
}

// ₹ amount. Keeps a STRING; digits and one dot, at most `decimals` decimals (default 2); pasting "₹1,299" works.
//   <MoneyInput value={price} onChange={setPrice} />        -> '1299.5'      parseNumber(price) -> 1299.5
export const MoneyInput = React.forwardRef(function MoneyInput({ value, onChange, decimals = 2, prefix = '₹', placeholder = '0', ...rest }, ref) {
  return (
    <TextInput
      ref={ref} value={value} prefix={prefix} inputMode="decimal" placeholder={placeholder} autoComplete="off"
      onChange={v => onChange && onChange(sanitizeDecimal(v, decimals))} {...rest}
    />
  );
});

// A count / quantity / percentage. Keeps a STRING. integer (default false) allows digits only. `suffix="days"`
// shows a unit. min / max are enforced on blur by clamping (typing is never blocked mid-edit); a text box is
// used instead of type="number" so the mouse wheel and arrow keys can never change a value by accident.
export const NumberInput = React.forwardRef(function NumberInput({ value, onChange, integer = false, min, max, decimals = 2, suffix, placeholder, onBlur, ...rest }, ref) {
  function clamp() {
    const s = String(value ?? '');
    if (s === '' || s === '.') return;
    let n = Number(s);
    if (!Number.isFinite(n)) return;
    if (min !== undefined && n < min) n = min;
    if (max !== undefined && n > max) n = max;
    if (String(n) !== s && onChange) onChange(String(n));
  }
  return (
    <TextInput
      ref={ref} value={value} suffix={suffix} inputMode={integer ? 'numeric' : 'decimal'} placeholder={placeholder} autoComplete="off"
      onChange={v => onChange && onChange(sanitizeDecimal(v, integer ? 0 : decimals))}
      onBlur={e => { clamp(); if (onBlur) onBlur(e); }} {...rest}
    />
  );
});

// An on/off switch with its own label. onChange(boolean).
//   <Toggle checked={form.cod_enabled} onChange={v => set('cod_enabled', v)} label="Accept Cash on Delivery"
//           hint="Shoppers see COD as a payment option." />
export function Toggle({ checked, onChange, label, hint, disabled = false, id: idProp, className = '' }) {
  const uid = useId();
  const id = idProp || `t${uid.replace(/:/g, '')}`;
  return (
    <div className={`adm-toggle ${className}`.trim()}>
      <input id={id} type="checkbox" role="switch" className="adm-toggle-input" checked={!!checked} disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined} onChange={e => onChange && onChange(e.target.checked)} />
      <label htmlFor={id} className="adm-toggle-track" aria-hidden="true" />
      <div className="adm-toggle-text">
        <label htmlFor={id} className="adm-toggle-label">{label}</label>
        {hint && <div id={`${id}-hint`} className="adm-hint">{hint}</div>}
      </div>
    </div>
  );
}

// A tick box with a label. onChange(boolean).
export function Checkbox({ checked, onChange, label, hint, disabled = false, id: idProp, className = '' }) {
  const uid = useId();
  const id = idProp || `c${uid.replace(/:/g, '')}`;
  return (
    <div className={`adm-check ${className}`.trim()}>
      <input id={id} type="checkbox" checked={!!checked} disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined} onChange={e => onChange && onChange(e.target.checked)} />
      <div>
        <label htmlFor={id}>{label}</label>
        {hint && <div id={`${id}-hint`} className="adm-hint">{hint}</div>}
      </div>
    </div>
  );
}

// Lays several <Field>s side by side (stacks on a phone). cols: 2 (default) | 3 | 4
export function FieldRow({ cols = 2, children, className = '' }) {
  return <div className={`adm-field-row cols-${cols} ${className}`.trim()}>{children}</div>;
}
