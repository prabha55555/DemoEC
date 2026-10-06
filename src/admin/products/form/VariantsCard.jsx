import React, { useEffect, useState } from 'react';
import { discountPercent } from '../../../utils/catalog';
import { Button, Card, Field, FieldRow, Icon, MoneyInput, NumberInput, Select, TextInput, Thumb, Toggle } from '../../ui';
import { useConfirm } from '../../hooks';
import { AddRow, EditableChip } from '../widgets';
import {
  MAX_OPTION_TYPES, MAX_VARIANTS, addType, addValue, applyToAll, blankType, comboCount, disableOptions, effectiveTypes, moveType,
  removeType, removeValue, removedWithStock, renameValue, setTypeName, suggestSku,
} from '../variantMatrix';

// "Pricing, options & variants": the heart of the product form. A product with no options is ONE variant (price, MRP,
// SKU, stock ...). Turning options on shows an option editor (Size: S, M, L · Colour: Red, Blue) and the variant table
// generated from it: one row per combination, each with its own SKU / price / MRP / stock / weight / picture.
// Structural edits go through the pure operations in variantMatrix.js; this file only presents them and asks before
// anything that would throw away stock.
const SUGGESTED = ['Size', 'Colour', 'Material', 'Style'];
const BULK_FIELDS = [
  { value: 'price', label: 'Price' }, { value: 'mrp', label: 'MRP' }, { value: 'stock', label: 'Stock' }, { value: 'weight_g', label: 'Weight (g)' },
];

export default function VariantsCard({ form, setForm, errors, variantErrors, showErrors }) {
  const confirm = useConfirm();
  const [msg, setMsg] = useState('');
  const [bulk, setBulk] = useState({ field: 'price', value: '' });
  const eff = effectiveTypes(form.optionTypes);
  const count = comboCount(form.optionTypes);
  const single = form.variants[0];
  const liveCount = form.variants.filter(v => v.active !== false).length;

  const setVariant = (key, patch) => setForm(f => ({ ...f, variants: f.variants.map(v => (v.key === key ? { ...v, ...patch } : v)) }));
  const err = (key, field) => (showErrors ? variantErrors[key]?.[field] : undefined);

  // Runs a structural edit; returns true when it was applied. Asks first if saved variants holding stock would go.
  async function run(op) {
    const res = op({ types: form.optionTypes, variants: form.variants });
    if (!res.ok) { setMsg(res.error); return false; }
    setMsg('');
    const lost = removedWithStock(res.removed);
    if (lost.length) {
      const units = lost.reduce((s, v) => s + (Number(v.stock) || 0), 0);
      const names = lost.slice(0, 4).map(v => v.label).join(', ');
      const yes = await confirm({
        title: 'Remove variants that hold stock?', tone: 'danger', confirmLabel: 'Remove them',
        message: `${lost.length} variant${lost.length === 1 ? '' : 's'} (${names}${lost.length > 4 ? '…' : ''}) hold ${units} unit${units === 1 ? '' : 's'} of stock. They are deleted when you save, and that stock is no longer tracked. To keep one, turn it off instead of removing it.`,
      });
      if (!yes) return false;
    }
    setForm(f => ({ ...f, optionTypes: res.types, variants: res.variants }));
    return true;
  }

  async function toggleOptions(on) {
    if (on) { setForm(f => ({ ...f, hasOptions: true, optionTypes: f.optionTypes.length ? f.optionTypes : [blankType()] })); return; }
    const many = form.variants.length > 1;
    if (many) {
      const lost = form.variants.slice(1);
      const units = removedWithStock(lost).reduce((s, v) => s + (Number(v.stock) || 0), 0);
      const yes = await confirm({
        title: 'Turn options off?', tone: 'danger', confirmLabel: 'Turn off options',
        message: `Only the first variant (${form.variants[0].label}) is kept, as the product's single default. The other ${lost.length} variant${lost.length === 1 ? ' is' : 's are'} deleted when you save${units ? `, along with ${units} unit${units === 1 ? '' : 's'} of stock` : ''}.`,
      });
      if (!yes) return;
    }
    const res = disableOptions({ types: form.optionTypes, variants: form.variants });
    setMsg('');
    setForm(f => ({ ...f, hasOptions: false, optionTypes: res.types, variants: res.variants }));
  }

  function generateSkus() {
    setForm((f) => {
      const taken = new Set(f.variants.map(v => v.sku.trim().toLowerCase()).filter(Boolean));
      const prefix = f.product_number.trim() || f.name.trim().split(/\s+/).slice(0, 2).join('');
      return { ...f, variants: f.variants.map(v => (v.sku.trim() ? v : (() => { const sku = suggestSku(prefix, v.options, taken); taken.add(sku.toLowerCase()); return { ...v, sku }; })())) };
    });
  }

  function applyBulk() {
    const v = bulk.value.trim();
    if (v === '') { setMsg('Type a value to apply.'); return; }
    setMsg('');
    setForm(f => ({ ...f, variants: applyToAll(f.variants, bulk.field, v) }));
  }

  const images = form.images;

  return (
    <Card title="Pricing, options & variants" subtitle="What the product costs, whether it comes in sizes or colours, and how much you have of each.">
      <div className="adm-stack">
        <Toggle checked={form.hasOptions} onChange={toggleOptions} label="This product has options (size, colour…)" hint="Each combination becomes a variant with its own price, SKU and stock." />

        {!form.hasOptions && single && (
          <div className="adm-stack tight" aria-label="Product price and stock">
            <FieldRow cols={3}>
              <Field label="Price" required error={err(single.key, 'price')} hint="What the customer pays, GST included.">
                <MoneyInput value={single.price} onChange={v => setVariant(single.key, { price: v })} />
              </Field>
              <Field label="MRP" optional error={err(single.key, 'mrp')} hint={<MrpHint price={single.price} mrp={single.mrp} />}>
                <MoneyInput value={single.mrp} onChange={v => setVariant(single.key, { mrp: v })} placeholder="List price" />
              </Field>
              <Field label="SKU" optional error={err(single.key, 'sku')} hint="Your own stock code. Must be unique.">
                <TextInput value={single.sku} onChange={v => setVariant(single.key, { sku: v })} maxLength={64} placeholder="e.g. MUG-BLUE" />
              </Field>
            </FieldRow>
            <FieldRow cols={3}>
              <Field label={single.id ? 'Stock' : 'Opening stock'} error={err(single.key, 'stock')}
                hint={single.track_inventory === false ? 'Unlimited: the product never sells out.' : single.id ? 'Changing this is recorded in the stock ledger.' : 'Recorded in the stock ledger when you save.'}>
                <NumberInput integer value={single.stock} onChange={v => setVariant(single.key, { stock: v })} disabled={single.track_inventory === false} placeholder={single.track_inventory === false ? 'Unlimited' : '0'} suffix="units" />
              </Field>
              <Field label="Weight" optional error={err(single.key, 'weight_g')} hint="Grams, for shipping.">
                <NumberInput integer value={single.weight_g} onChange={v => setVariant(single.key, { weight_g: v })} suffix="g" />
              </Field>
              <div className="pv-track">
                <Toggle checked={single.track_inventory !== false} onChange={v => setVariant(single.key, { track_inventory: v })} label="Track inventory" hint="Off = unlimited stock." />
              </div>
            </FieldRow>
          </div>
        )}

        {form.hasOptions && (
          <>
            <div className="pv-options">
              {form.optionTypes.map((t, i) => (
                <OptionTypeEditor
                  key={t.id} type={t} index={i} total={form.optionTypes.length}
                  onName={(name) => run(s => setTypeName(s, t.id, name))}
                  onAddValues={(text) => addValues(run, t.id, text)}
                  onRenameValue={(from, to) => run(s => renameValue(s, t.id, from, to))}
                  onRemoveValue={(value) => run(s => removeValue(s, t.id, value))}
                  onRemoveType={() => run(s => removeType(s, t.id))}
                  onMove={(d) => run(s => moveType(s, t.id, d))}
                />
              ))}
              {form.optionTypes.length < MAX_OPTION_TYPES && (
                <div><Button size="sm" icon="plus" onClick={() => run(addType)}>{form.optionTypes.length ? 'Add another option' : 'Add an option'}</Button></div>
              )}
              {msg && <div className="adm-error" role="alert">{msg}</div>}
              {showErrors && errors.options && <div className="adm-error" role="alert">{errors.options}</div>}
              <p className="adm-hint">
                {eff.length ? `${count} variant${count === 1 ? '' : 's'} (the limit is ${MAX_VARIANTS}). ` : ''}
                Click a value to rename it; renaming or removing a value updates every variant that uses it. Adding a value adds only the combinations that are missing.
              </p>
            </div>

            {eff.length > 0 && (
              <>
                <div className="pv-bulk" role="group" aria-label="Apply one value to every variant">
                  <span className="adm-label">Apply to all</span>
                  <Select value={bulk.field} onChange={field => setBulk(b => ({ ...b, field }))} options={BULK_FIELDS} aria-label="Field to apply" />
                  <div className="pv-bulk-input">
                    <TextInput value={bulk.value} inputMode="decimal" placeholder={bulk.field === 'price' || bulk.field === 'mrp' ? '₹' : '0'} aria-label="Value to apply"
                      onChange={v => setBulk(b => ({ ...b, value: v.replace(/[^\d.]/g, '') }))} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyBulk(); } }} />
                  </div>
                  <Button size="sm" onClick={applyBulk}>Apply to all {form.variants.length}</Button>
                  <span className="pv-bulk-gap" />
                  <Button size="sm" icon="tag" onClick={generateSkus} disabled={!form.variants.some(v => !v.sku.trim())}>Generate missing SKUs</Button>
                </div>

                <div className="pv-scroll">
                  <div className="pv-table" role="table" aria-label="Variants">
                    <div className="pv-head" role="row">
                      <span role="columnheader">Variant</span><span role="columnheader">SKU</span><span role="columnheader">Price</span><span role="columnheader">MRP</span>
                      <span role="columnheader">Stock</span><span role="columnheader">Track</span><span role="columnheader">On sale</span><span role="columnheader">Weight</span><span role="columnheader">Picture</span>
                    </div>
                    {form.variants.map((v) => {
                      const name = v.label;
                      return (
                        <div className={`pv-row${v.active === false ? ' is-off' : ''}`} role="row" key={v.key}>
                          <div className="pv-cell pv-name" role="cell" data-label="Variant">
                            <strong>{name}</strong>
                            <span className="adm-cell-sub">{v.id ? 'Saved' : 'New'}{v.active === false ? ' · disabled' : ''}</span>
                          </div>
                          <div className="pv-cell" role="cell" data-label="SKU">
                            <TextInput value={v.sku} onChange={x => setVariant(v.key, { sku: x })} aria-label={`SKU for ${name}`} invalid={!!err(v.key, 'sku')} maxLength={64} placeholder="Optional" />
                            {err(v.key, 'sku') && <span className="pv-err">{err(v.key, 'sku')}</span>}
                          </div>
                          <div className="pv-cell" role="cell" data-label="Price">
                            <MoneyInput value={v.price} onChange={x => setVariant(v.key, { price: x })} aria-label={`Price for ${name}`} invalid={!!err(v.key, 'price')} />
                            {err(v.key, 'price') && <span className="pv-err">{err(v.key, 'price')}</span>}
                          </div>
                          <div className="pv-cell" role="cell" data-label="MRP">
                            <MoneyInput value={v.mrp} onChange={x => setVariant(v.key, { mrp: x })} aria-label={`MRP for ${name}`} invalid={!!err(v.key, 'mrp')} placeholder="" />
                            {err(v.key, 'mrp') && <span className="pv-err">{err(v.key, 'mrp')}</span>}
                          </div>
                          <div className="pv-cell" role="cell" data-label={v.id ? 'Stock' : 'Opening stock'}>
                            <NumberInput integer value={v.stock} onChange={x => setVariant(v.key, { stock: x })} disabled={v.track_inventory === false} aria-label={`Stock for ${name}`} invalid={!!err(v.key, 'stock')} placeholder={v.track_inventory === false ? '∞' : '0'} />
                            {err(v.key, 'stock') && <span className="pv-err">{err(v.key, 'stock')}</span>}
                          </div>
                          <div className="pv-cell pv-check" role="cell" data-label="Track stock">
                            <input type="checkbox" checked={v.track_inventory !== false} onChange={e => setVariant(v.key, { track_inventory: e.target.checked })} aria-label={`Track stock for ${name}`} />
                          </div>
                          <div className="pv-cell pv-check" role="cell" data-label="On sale">
                            <input type="checkbox" checked={v.active !== false} onChange={e => setVariant(v.key, { active: e.target.checked })} aria-label={`${name} is on sale`} />
                          </div>
                          <div className="pv-cell" role="cell" data-label="Weight (g)">
                            <NumberInput integer value={v.weight_g} onChange={x => setVariant(v.key, { weight_g: x })} aria-label={`Weight in grams for ${name}`} invalid={!!err(v.key, 'weight_g')} />
                          </div>
                          <div className="pv-cell pv-pic" role="cell" data-label="Picture">
                            <Thumb src={v.image_url} width={72} size={30} />
                            <select className="adm-input" value={v.image_url || ''} onChange={e => setVariant(v.key, { image_url: e.target.value })} aria-label={`Picture for ${name}`} disabled={!images.length}>
                              <option value="">{images.length ? 'Default' : 'No photos'}</option>
                              {images.map((u, i) => <option key={u} value={u}>Photo {i + 1}</option>)}
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <p className="adm-hint">
                  <Icon name="info" size={13} /> Turn a variant off (“On sale”) to hide it without deleting it.
                  {form.variants.some(v => v.id) ? ' Stock edits to saved variants are recorded in the stock ledger.' : ' Opening stock is recorded in the stock ledger when you save.'}
                  {liveCount === 0 ? ' All variants are off: shoppers will not be able to buy this product.' : ''}
                </p>
              </>
            )}
          </>
        )}
        {showErrors && errors.variants && <div className="adm-error" role="alert">{errors.variants}</div>}
      </div>
    </Card>
  );
}

// "Add value" accepts several at once ("S, M, L"): each is added in turn on the running state and committed once.
// Returns an error sentence (shown under the box) or '' when everything was added.
async function addValues(run, typeId, text) {
  const parts = String(text).split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return 'Type a value to add, e.g. M.';
  let message = '';
  const ok = await run((state) => {
    let cur = state;
    let applied = 0;
    const removed = [];
    for (const p of parts) {
      const r = addValue(cur, typeId, p);
      if (!r.ok) { message = r.error; if (!applied) return r; break; }
      removed.push(...r.removed);
      cur = { types: r.types, variants: r.variants };
      applied += 1;
    }
    return { ok: true, types: cur.types, variants: cur.variants, removed };
  });
  return ok ? message : (message || 'That value could not be added.');
}

function MrpHint({ price, mrp }) {
  const p = Number(price);
  const m = Number(mrp);
  if (!price || !mrp || !Number.isFinite(p) || !Number.isFinite(m)) return 'The “was” price shown struck through.';
  if (m < p) return <span style={{ color: 'var(--error)', fontWeight: 600 }}>MRP should be at least the price.</span>;
  const off = discountPercent(p, m);
  return off > 0 ? <span style={{ color: '#0F7B53', fontWeight: 700 }}>{off}% off shown to shoppers</span> : 'Same as the price: no discount shown.';
}

function OptionTypeEditor({ type, index, total, onName, onAddValues, onRenameValue, onRemoveValue, onRemoveType, onMove }) {
  const [name, setName] = useState(type.name);
  const [nameError, setNameError] = useState('');
  useEffect(() => { setName(type.name); }, [type.name]);

  async function commit() {
    const t = name.trim();
    if (t === type.name) { setNameError(''); return; }
    if (!t) { if (type.name) setName(type.name); return; }
    const ok = await onName(t);
    if (!ok) { setNameError('That name could not be used.'); setName(type.name); } else setNameError('');
  }

  return (
    <div className="pv-option">
      <div className="pv-option-head">
        <div className="pv-option-name">
          <label className="adm-label" htmlFor={`pv-name-${type.id}`}>Option {index + 1}</label>
          <input
            id={`pv-name-${type.id}`} className="adm-input" value={name} maxLength={30} placeholder="Option name, e.g. Size" aria-invalid={nameError ? true : undefined}
            onChange={e => setName(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { setName(type.name); } }}
          />
          {!type.name && !name && (
            <div className="pv-suggest" aria-label="Suggested option names">
              {SUGGESTED.map(s => <button type="button" key={s} className="pv-suggest-btn" onClick={async () => { setName(s); const ok = await onName(s); if (!ok) setName(''); }}>{s}</button>)}
            </div>
          )}
        </div>
        <div className="pv-option-tools">
          <Button size="sm" variant="ghost" iconOnly icon="arrowUp" aria-label={`Move option ${type.name || index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)} />
          <Button size="sm" variant="ghost" iconOnly icon="arrowDown" aria-label={`Move option ${type.name || index + 1} down`} disabled={index === total - 1} onClick={() => onMove(1)} />
          <Button size="sm" variant="ghost" iconOnly icon="trash" aria-label={`Remove option ${type.name || index + 1}`} onClick={onRemoveType} />
        </div>
      </div>
      {nameError && <div className="adm-error" role="alert">{nameError}</div>}
      <div className="pv-values">
        {type.values.map(v => (
          <EditableChip key={v} value={v} ariaName={type.name || 'value'} onRename={to => onRenameValue(v, to)} onRemove={() => onRemoveValue(v)} />
        ))}
        {type.values.length === 0 && type.name && <span className="adm-hint">No values yet.</span>}
      </div>
      <AddRow
        placeholder={type.name ? `Add ${type.name.toLowerCase()} values, e.g. ${type.name.toLowerCase() === 'colour' ? 'Red, Blue' : 'S, M, L'}` : 'Name the option first'}
        ariaLabel={`Add values to ${type.name || 'this option'}`} disabled={!type.name} buttonLabel="Add" maxLength={200}
        onAdd={onAddValues}
      />
    </div>
  );
}
