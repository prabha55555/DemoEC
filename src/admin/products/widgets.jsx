import React, { useState } from 'react';
import { Button, Icon } from '../ui';

// Small editors the product form (and the category form) share. All controls call onChange(value), like the kit's.

// Tags: type and press Enter or comma; Backspace on an empty box removes the last tag. Pasting "a, b, c" adds three.
export function ChipInput({ value = [], onChange, placeholder = 'Type a tag and press Enter', max = 20, maxLength = 30, label = 'Tags', invalid = false }) {
  const [draft, setDraft] = useState('');
  const add = (raw) => {
    const parts = String(raw).split(/[,\n]/).map(s => s.replace(/\s+/g, ' ').trim().slice(0, maxLength)).filter(Boolean);
    if (!parts.length) return;
    const have = new Set(value.map(v => v.toLowerCase()));
    const next = [...value];
    for (const p of parts) if (!have.has(p.toLowerCase()) && next.length < max) { next.push(p); have.add(p.toLowerCase()); }
    onChange(next);
    setDraft('');
  };
  return (
    <div className={`pf-chips${invalid ? ' pf-invalid' : ''}`}>
      {value.map(t => (
        <span className="pf-chip" key={t}>
          {t}
          <button type="button" className="pf-chip-x" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter(x => x !== t))}><Icon name="close" size={12} /></button>
        </span>
      ))}
      <input
        className="pf-chip-input" value={draft} placeholder={value.length ? '' : placeholder} aria-label={label} aria-invalid={invalid || undefined} maxLength={maxLength + 1}
        onChange={e => { const v = e.target.value; if (/[,\n]/.test(v)) add(v); else setDraft(v); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); add(draft); }
          else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(draft)}
      />
    </div>
  );
}

// A reorderable list of one-line texts (product highlights): Enter adds a row below, arrows reorder, x removes.
export function BulletListEditor({ items, onChange, makeItem, max = 10, maxLength = 160, placeholder = 'e.g. 100% cotton, machine washable', addLabel = 'Add highlight' }) {
  const setText = (id, text) => onChange(items.map(h => (h.id === id ? { ...h, text } : h)));
  const move = (i, d) => { const next = [...items]; const j = i + d; if (j < 0 || j >= next.length) return; [next[i], next[j]] = [next[j], next[i]]; onChange(next); };
  const addAfter = (i) => { if (items.length >= max) return; const next = [...items]; const item = makeItem(); next.splice(i + 1, 0, item); onChange(next); setTimeout(() => document.getElementById(`pf-bullet-${item.id}`)?.focus(), 0); };
  return (
    <div className="pf-bullets">
      {items.map((h, i) => (
        <div className="pf-bullet" key={h.id}>
          <span className="pf-bullet-dot" aria-hidden="true" />
          <input
            id={`pf-bullet-${h.id}`} className="adm-input" value={h.text} maxLength={maxLength} placeholder={placeholder} aria-label={`Highlight ${i + 1}`}
            onChange={e => setText(h.id, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAfter(i); } }}
          />
          <div className="pf-bullet-tools">
            <Button size="sm" variant="ghost" iconOnly icon="arrowUp" aria-label={`Move highlight ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)} />
            <Button size="sm" variant="ghost" iconOnly icon="arrowDown" aria-label={`Move highlight ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)} />
            <Button size="sm" variant="ghost" iconOnly icon="close" aria-label={`Remove highlight ${i + 1}`} onClick={() => onChange(items.filter(x => x.id !== h.id))} />
          </div>
        </div>
      ))}
      {items.length < max && <div><Button size="sm" icon="plus" onClick={() => addAfter(items.length - 1)}>{addLabel}</Button></div>}
    </div>
  );
}

// A value chip that can be renamed in place: click the text, edit, Enter to apply, Escape to cancel.
export function EditableChip({ value, onRename, onRemove, ariaName }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const commit = () => { setEditing(false); const t = draft.trim(); if (t && t !== value) onRename(t); else setDraft(value); };
  if (editing) {
    return (
      <span className="pf-chip is-editing">
        <input
          className="pf-chip-edit" value={draft} autoFocus aria-label={`Rename ${ariaName} ${value}`} maxLength={40}
          onChange={e => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { e.stopPropagation(); setDraft(value); setEditing(false); } }}
        />
      </span>
    );
  }
  return (
    <span className="pf-chip">
      <button type="button" className="pf-chip-text" onClick={() => { setDraft(value); setEditing(true); }} title="Click to rename" aria-label={`${value} - click to rename`}>{value}</button>
      <button type="button" className="pf-chip-x" aria-label={`Remove ${ariaName} ${value}`} onClick={onRemove}><Icon name="close" size={12} /></button>
    </span>
  );
}

// A little "Add" row: text box + button, Enter adds. onAdd(text) may be async and return an error string to show
// (an empty / falsy result clears the box).
export function AddRow({ placeholder, buttonLabel = 'Add', onAdd, ariaLabel, disabled = false, maxLength = 120 }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const submit = async () => {
    if (!draft.trim()) return;
    const err = await onAdd(draft);
    if (err) setError(err); else { setDraft(''); setError(''); }
  };
  return (
    <div>
      <div className="pf-addrow">
        <input
          className="adm-input" value={draft} placeholder={placeholder} aria-label={ariaLabel || placeholder} disabled={disabled} maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          onChange={e => { setDraft(e.target.value); if (error) setError(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        />
        <Button size="sm" icon="plus" onClick={submit} disabled={disabled || !draft.trim()}>{buttonLabel}</Button>
      </div>
      {error && <div className="adm-error" role="alert" style={{ marginTop: 4 }}>{error}</div>}
    </div>
  );
}
