import React from 'react';
import { Button, Checkbox, Field, Icon, Select, TextInput } from '../ui';
import { useConfirm } from '../hooks';
import { ChipInput } from './widgets';
import { ATTRIBUTE_TYPES, attributeKeyFromLabel, hasOptions } from './attributes';
import { newKey } from './variantMatrix';

// The attribute-schema editor on the category form: the fields products in this category (and its sub-categories)
// are asked for. A row is { id, key, label, type, options, unit, required, filterable, locked, keyTouched }.
//   * the key is generated from the label until the row has been SAVED (`locked`): products store their values under
//     it, so it can no longer change. Until then it can be edited by hand (`keyTouched` stops the auto-update).
//   * attributes inherited from the parent are listed read-only above the rows.
export const blankRow = () => ({ id: newKey('a'), key: '', label: '', type: 'text', options: [], unit: '', required: false, filterable: false, locked: false, keyTouched: false });

export function rowsFromSchema(schema) {
  return (Array.isArray(schema) ? schema : []).filter(a => a && a.key).map(a => ({
    id: newKey('a'), key: a.key, label: a.label || a.key, type: a.type || 'text', options: Array.isArray(a.options) ? a.options : [],
    unit: a.unit || '', required: !!a.required, filterable: !!a.filterable, locked: true, keyTouched: true,
  }));
}

export default function SchemaEditor({ rows, onChange, inherited = [], inheritedFrom = '', errors = [] }) {
  const confirm = useConfirm();
  const taken = (except) => [...rows.filter(r => r.id !== except).map(r => r.key).filter(Boolean), ...inherited.map(a => a.key)];
  const patch = (id, p) => onChange(rows.map(r => (r.id === id ? { ...r, ...p } : r)));

  function setLabel(r, label) {
    const next = { label };
    if (!r.locked && !r.keyTouched) next.key = label.trim() ? attributeKeyFromLabel(label, taken(r.id)) : '';
    patch(r.id, next);
  }
  function setType(r, type) {
    patch(r.id, { type, ...(type === 'multiselect' ? { filterable: false } : {}) });
  }
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= rows.length) return; const next = [...rows]; [next[i], next[j]] = [next[j], next[i]]; onChange(next); };
  async function remove(r) {
    if (r.locked) {
      const yes = await confirm({
        title: `Remove “${r.label}”?`, confirmLabel: 'Remove attribute', tone: 'danger',
        message: 'Products keep the values they already have; they move to “Other specifications” on the product form. Shop filters on this attribute disappear.',
      });
      if (!yes) return;
    }
    onChange(rows.filter(x => x.id !== r.id));
  }

  return (
    <div className="adm-stack">
      {inherited.length > 0 && (
        <div className="pc-inherited">
          <div className="adm-label">Inherited{inheritedFrom ? ` from ${inheritedFrom}` : ''} <span className="adm-opt">read-only</span></div>
          <div className="pc-inherited-list">
            {inherited.map(a => <span className="adm-chip" key={a.key} title={`Key: ${a.key}`}>{a.label}<span className="adm-muted"> · {typeLabel(a.type)}{a.required ? ' · required' : ''}{a.filterable ? ' · filter' : ''}</span></span>)}
          </div>
        </div>
      )}

      {rows.length === 0 && <div className="adm-note">No attributes of its own yet. Add the details products in this category should be described by, such as Material, Warranty or Size chart.</div>}

      <div className="pc-attrs">
        {rows.map((r, i) => {
          const e = errors[i] || {};
          return (
            <div className="pc-attr" key={r.id}>
              <div className="pc-attr-top">
                <Field label="Label" required error={e.label} className="pc-attr-label">
                  <TextInput value={r.label} onChange={v => setLabel(r, v)} maxLength={60} placeholder="e.g. Material" />
                </Field>
                <Field label="Type" className="pc-attr-type">
                  <Select value={r.type} onChange={v => setType(r, v)} options={ATTRIBUTE_TYPES} />
                </Field>
                <div className="pc-attr-tools">
                  <Button size="sm" variant="ghost" iconOnly icon="arrowUp" aria-label={`Move ${r.label || 'attribute'} up`} disabled={i === 0} onClick={() => move(i, -1)} />
                  <Button size="sm" variant="ghost" iconOnly icon="arrowDown" aria-label={`Move ${r.label || 'attribute'} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)} />
                  <Button size="sm" variant="ghost" iconOnly icon="trash" aria-label={`Remove ${r.label || 'attribute'}`} onClick={() => remove(r)} />
                </div>
              </div>
              <div className="pc-attr-key">
                <span className="adm-hint">Key</span>
                {r.locked ? (
                  <code className="adm-mono" title="Products store their values under this key, so it cannot change once saved.">{r.key} <Icon name="lock" size={12} /></code>
                ) : (
                  <input className="adm-input pc-key-input" value={r.key} aria-label={`Key for ${r.label || 'this attribute'}`} aria-invalid={e.key ? true : undefined} maxLength={40}
                    onChange={ev => patch(r.id, { key: ev.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''), keyTouched: true })} placeholder="generated from the label" />
                )}
                {e.key && <span className="adm-error">{e.key}</span>}
              </div>
              {hasOptions(r.type) && (
                <Field label="Choices" required error={e.options} hint="Press Enter after each choice. Shoppers and staff pick from these.">
                  <ChipInput value={r.options} onChange={v => patch(r.id, { options: v })} max={40} maxLength={40} label={`Choices for ${r.label || 'this attribute'}`} placeholder="Add a choice and press Enter" invalid={!!e.options} />
                </Field>
              )}
              {r.type === 'number' && (
                <div style={{ maxWidth: 220 }}>
                  <Field label="Unit" optional hint="Shown after the number, e.g. cm, kg, W."><TextInput value={r.unit} onChange={v => patch(r.id, { unit: v })} maxLength={12} placeholder="e.g. cm" /></Field>
                </div>
              )}
              <div className="pc-attr-flags">
                <Checkbox checked={r.required} onChange={v => patch(r.id, { required: v })} label="Required" hint="Must be filled in before a product can be published." />
                <Checkbox checked={r.filterable && r.type !== 'multiselect'} onChange={v => patch(r.id, { filterable: v })} disabled={r.type === 'multiselect'} label="Show as a shop filter"
                  hint={r.type === 'multiselect' ? 'Not available for multiple-choice attributes. Use a single choice to filter on it.' : 'Shoppers can narrow the shop page by this attribute.'} />
              </div>
            </div>
          );
        })}
      </div>
      <div><Button icon="plus" onClick={() => onChange([...rows, blankRow()])}>Add attribute</Button></div>
    </div>
  );
}

const typeLabel = (t) => (ATTRIBUTE_TYPES.find(x => x.value === t)?.label || t).replace(/ \(.*\)$/, '');
