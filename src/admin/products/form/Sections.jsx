import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import ImageUploader from '../../../components/ImageUploader';
import { categoryChain, discountPercent, formatMoney } from '../../../utils/catalog';
import { resolveGstRate, resolveHsn } from '../../../utils/tax';
import { clampVideoPosition } from '../../../utils/productMedia';
import { Button, Card, Field, FieldRow, ImagePositionPicker, MediaUrlField, NumberInput, Select, TextInput, Textarea, Thumb, Toggle } from '../../ui';
import { BulletListEditor, ChipInput } from '../widgets';
import { LIMITS, STATUSES, clip, dropMissingVariantImages, extraId, highlightId } from '../productForm';

// The smaller cards of the product form. Each gets the form, a `set(key, value)` and the (already filtered) errors.

// ───────────────────────────────────────────────────────────────────────────────────────── Basic information
export function BasicInfoCard({ form, set, errors, tree }) {
  return (
    <Card title="Basic information">
      <div className="adm-stack">
        <Field label="Product name" required error={errors.name}>
          <TextInput value={form.name} onChange={v => set('name', v)} maxLength={LIMITS.name} placeholder="e.g. Cotton Kurta Set" />
        </Field>
        <FieldRow cols={2}>
          <Field label="Brand" optional error={errors.brand}><TextInput value={form.brand} onChange={v => set('brand', v)} maxLength={LIMITS.brand} placeholder="e.g. Kaveri Weaves" /></Field>
          <Field label="Product number" optional error={errors.product_number} hint="Your own code for this product. A CSV import uses it to find the product again. Left blank, one is assigned.">
            <TextInput value={form.product_number} onChange={v => set('product_number', v)} maxLength={LIMITS.productNumber} placeholder="e.g. KUR-001" />
          </Field>
        </FieldRow>
        <Field label="Category" required error={errors.category_id} hint="Groups products in the store menu and decides which specification fields appear below. Needed before you can publish.">
          <Select value={form.category_id} onChange={v => set('category_id', v)} placeholder="Choose a category">
            {tree.map(root => (root.children.length ? (
              <optgroup key={root.id} label={root.name}>
                {root.children.map(c => <option key={c.id} value={c.id}>{c.name}{c.active === false ? ' (hidden)' : ''}</option>)}
              </optgroup>
            ) : <option key={root.id} value={root.id}>{root.name}{root.active === false ? ' (hidden)' : ''}</option>))}
          </Select>
        </Field>
        <Field label="Subtitle" optional error={errors.subtitle} hint="One line shown under the name.">
          <TextInput value={form.subtitle} onChange={v => set('subtitle', v)} maxLength={LIMITS.subtitle} placeholder="e.g. Straight-fit kurta with embroidered placket" />
        </Field>
        <Field label="Description" optional error={errors.description}>
          <Textarea rows={7} value={form.description} onChange={v => set('description', v)} maxLength={LIMITS.description} showCount placeholder="What is it, what is it made of, who is it for?" />
        </Field>
        <Field label="Highlights" optional error={errors.highlights} hint="Short bullet points shown near the price. Use the arrows to reorder.">
          <BulletListEditor items={form.highlights} onChange={v => set('highlights', v)} makeItem={() => ({ id: highlightId(), text: '' })} max={LIMITS.highlights} maxLength={LIMITS.highlight} />
        </Field>
        <Field label="Tags" optional error={errors.tags} hint="Words shoppers might search for. Press Enter or comma after each.">
          <ChipInput value={form.tags} onChange={v => set('tags', v)} max={LIMITS.tags} maxLength={LIMITS.tag} />
        </Field>
      </div>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────── Media
export function MediaCard({ form, setForm, set, errors, pid }) {
  const [videoDraft, setVideoDraft] = useState('');
  const [coverDraft, setCoverDraft] = useState('');
  const onImages = (images) => setForm(f => ({
    ...f, images, variants: dropMissingVariantImages(f.variants, images), video_position: clampVideoPosition(f.video_position, images.length),
  }));
  return (
    <Card title="Photos & video" subtitle="The first photo is the main image in the shop grid.">
      <div className="adm-stack">
        <ImageUploader
          key={pid || 'new'} label="Product photos" images={form.images} onChange={onImages} folder="products"
          help="Upload JPG, PNG or WebP files, or paste a link. Use the arrows to reorder; the first one is the main photo."
          video={form.video_url ? { videoUrl: form.video_url, videoPosition: form.video_position, onVideoPositionChange: v => set('video_position', v) } : null}
        />
        {errors.images && <div className="adm-error" role="alert">{errors.images}</div>}
        {!errors.images && form.images.length === 0 && <div className="adm-hint">No photos yet. You can save a draft without one, but add at least one before you publish.</div>}
        {form.images.length > 0 && (
          <ImagePositionPicker image={form.images[0]} value={form.image_position} onChange={v => set('image_position', v)} aspect="1/1" label="Focal point of the main photo (which part stays visible when the photo is cropped to a square)" />
        )}

        <div className="adm-media-block">
          <div className="adm-media-title">Product video <span className="adm-opt">optional</span></div>
          {form.video_url ? (
            <>
              <div className="pf-video">
                <video src={form.video_url} controls muted preload="metadata" className="adm-media-preview" style={{ maxHeight: 180 }} />
                <Button size="sm" variant="danger" icon="trash" onClick={() => setForm(f => ({ ...f, video_url: '', video_cover_url: '', video_position: 0 }))}>Remove video</Button>
              </div>
              <div className="adm-hint">Use the video tile's arrows in the photo grid above to choose where it appears among the photos.</div>
              <div>
                <div className="adm-label" style={{ marginBottom: 6 }}>Video cover image <span className="adm-opt">optional</span></div>
                {form.video_cover_url ? (
                  <div className="pf-video">
                    <Thumb src={form.video_cover_url} width={160} size={64} />
                    <Button size="sm" onClick={() => set('video_cover_url', '')}>Remove cover</Button>
                  </div>
                ) : (
                  <MediaUrlField value={coverDraft} onChange={setCoverDraft} onSave={(url) => { set('video_cover_url', url); setCoverDraft(''); }} accept="image/*" folder="products" placeholder="Paste a cover image URL…" label="Video cover image URL" saveLabel="Use link" />
                )}
              </div>
              {form.video_cover_url && <ImagePositionPicker image={form.video_cover_url} value={form.video_cover_position} onChange={v => set('video_cover_position', v)} aspect="1/1" label="Focal point of the video cover" />}
            </>
          ) : (
            <MediaUrlField value={videoDraft} onChange={setVideoDraft} onSave={(url) => { set('video_url', url); setVideoDraft(''); }} accept="video/mp4,video/webm" folder="products" placeholder="Paste a video link (MP4 or WebM)…" label="Video URL" saveLabel="Use link" />
          )}
          {errors.video_url && <div className="adm-error" role="alert">{errors.video_url}</div>}
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────── Attributes
export function AttributesCard({ form, setForm, schema, attrErrors, errors, categoryName }) {
  const setAttr = (key, value) => setForm(f => ({ ...f, attributes: { ...f.attributes, [key]: value } }));
  const clearAttr = (key) => setForm((f) => { const a = { ...f.attributes }; delete a[key]; return { ...f, attributes: a }; });
  const setExtra = (id, patch) => setForm(f => ({ ...f, extras: f.extras.map(x => (x.id === id ? { ...x, ...patch } : x)) }));
  return (
    <Card title="Specifications" subtitle={form.category_id ? `Details for ${categoryName || 'this category'}, shown in the product's specification table.` : 'Choose a category to see its specification fields.'}>
      <div className="adm-stack">
        {form.category_id && schema.length === 0 && (
          <div className="adm-note info">This category has no specification fields yet. Add some under <Link to="/admin/categories">Categories</Link>, or use “Other specifications” below.</div>
        )}
        {schema.length > 0 && (
          <FieldRow cols={2}>
            {schema.map(def => (
              <Field key={def.key} label={def.label} required={!!def.required} optional={!def.required && false} error={attrErrors[def.key]} hint={def.required ? 'Required to publish.' : undefined}>
                <AttributeInput def={def} value={form.attributes[def.key]} onChange={v => setAttr(def.key, v)} onClear={() => clearAttr(def.key)} />
              </Field>
            ))}
          </FieldRow>
        )}
        <div>
          <div className="adm-label" style={{ marginBottom: 6 }}>Other specifications <span className="adm-opt">optional</span></div>
          <div className="adm-hint" style={{ marginBottom: 8 }}>Anything that is not in the fields above, e.g. “Country of origin: India”.</div>
          <div className="pf-extras">
            {form.extras.map((x, i) => (
              <div className="pf-extra" key={x.id}>
                <input className="adm-input" value={x.key} maxLength={60} placeholder="Name" aria-label={`Specification ${i + 1} name`} onChange={e => setExtra(x.id, { key: e.target.value })} />
                <input className="adm-input" value={x.value} maxLength={200} placeholder="Value" aria-label={`Specification ${i + 1} value`} onChange={e => setExtra(x.id, { value: e.target.value })} />
                <Button size="sm" variant="ghost" iconOnly icon="close" aria-label={`Remove specification ${i + 1}`} onClick={() => setForm(f => ({ ...f, extras: f.extras.filter(e => e.id !== x.id) }))} />
              </div>
            ))}
            <div><Button size="sm" icon="plus" onClick={() => setForm(f => ({ ...f, extras: [...f.extras, { id: extraId(), key: '', value: '' }] }))}>Add specification</Button></div>
          </div>
          {errors.extras && <div className="adm-error" role="alert" style={{ marginTop: 6 }}>{errors.extras}</div>}
        </div>
      </div>
    </Card>
  );
}

function AttributeInput({ def, value, onChange, onClear }) {
  switch (def.type) {
    case 'number':
      return <NumberInput value={value ?? ''} onChange={onChange} decimals={3} suffix={def.unit || undefined} />;
    case 'select': {
      const opts = [...(def.options || [])];
      if (value && !opts.includes(value)) opts.push(value);
      return <Select value={value ?? ''} onChange={onChange} options={opts} placeholder="Not set" />;
    }
    case 'multiselect': {
      const selected = Array.isArray(value) ? value : [];
      const opts = [...(def.options || []), ...selected.filter(v => !(def.options || []).includes(v))];
      const toggle = (o) => onChange(selected.includes(o) ? selected.filter(x => x !== o) : [...selected, o]);
      return (
        <div className="pf-multi" role="group" aria-label={def.label}>
          {opts.map(o => <button type="button" key={o} className={`pf-toggle${selected.includes(o) ? ' is-on' : ''}`} aria-pressed={selected.includes(o)} onClick={() => toggle(o)}>{o}</button>)}
          {opts.length === 0 && <span className="adm-hint">This attribute has no choices yet.</span>}
        </div>
      );
    }
    case 'boolean':
      return (
        <div className="pf-bool">
          <Toggle checked={value === true} onChange={onChange} label={value === true ? 'Yes' : value === false ? 'No' : 'Not set'} />
          {typeof value === 'boolean' && <button type="button" className="adm-link-btn" onClick={onClear}>Clear</button>}
        </div>
      );
    default:
      return <TextInput value={value ?? ''} onChange={onChange} maxLength={200} />;
  }
}

// ──────────────────────────────────────────────────────────────────────────────────── Shipping & policies
export function ShippingCard({ form, set, errors, categories, brand }) {
  const chain = categoryChain(categories, form.category_id);
  const gst = resolveGstRate({ product: {}, categoryChain: chain, defaultRate: brand.default_gst_rate });
  const hsn = resolveHsn({ product: {}, categoryChain: chain });
  const gstSource = chain.find(c => c.gst_rate !== null && c.gst_rate !== undefined && c.gst_rate !== '') ? `from ${chain.find(c => c.gst_rate !== null && c.gst_rate !== undefined && c.gst_rate !== '').name}` : 'store default';
  const storeDays = Number(brand.return_window_days);
  return (
    <Card title="Shipping & policies">
      <div className="adm-stack">
        <FieldRow cols={4}>
          <Field label="Weight" optional error={errors.weight_g} hint="Default, in grams. A variant can have its own."><NumberInput integer value={form.weight_g} onChange={v => set('weight_g', v)} suffix="g" /></Field>
          <Field label="Length" optional error={errors.length_cm}><NumberInput value={form.length_cm} onChange={v => set('length_cm', v)} suffix="cm" /></Field>
          <Field label="Width" optional error={errors.width_cm}><NumberInput value={form.width_cm} onChange={v => set('width_cm', v)} suffix="cm" /></Field>
          <Field label="Height" optional error={errors.height_cm}><NumberInput value={form.height_cm} onChange={v => set('height_cm', v)} suffix="cm" /></Field>
        </FieldRow>
        <Toggle checked={form.free_shipping} onChange={v => set('free_shipping', v)} label="Free shipping on this product"
          hint="It ships free whatever the order total, regardless of the store's free-delivery threshold." />
        <FieldRow cols={2}>
          <Field label="Delivery time (min)" optional error={errors.delivery_min_days} hint="Business days. Leave both blank to use the default (5–8)."><NumberInput integer value={form.delivery_min_days} onChange={v => set('delivery_min_days', v)} suffix="days" placeholder="5" /></Field>
          <Field label="Delivery time (max)" optional error={errors.delivery_max_days}><NumberInput integer value={form.delivery_max_days} onChange={v => set('delivery_max_days', v)} suffix="days" placeholder="8" /></Field>
        </FieldRow>
        <Toggle checked={form.cod_allowed} onChange={v => set('cod_allowed', v)} label="Allow Cash on Delivery" hint="Applies only while Cash on Delivery is switched on for the store (Settings → Payments)." />

        <fieldset className="pf-radios">
          <legend className="adm-label">Returns</legend>
          <label className="pf-radio">
            <input type="radio" name="return-mode" checked={form.returnMode === 'default'} onChange={() => set('returnMode', 'default')} />
            <span>Use the store default <span className="adm-muted">({storeDays > 0 ? `${storeDays} day${storeDays === 1 ? '' : 's'}` : 'not returnable'})</span></span>
          </label>
          <label className="pf-radio">
            <input type="radio" name="return-mode" checked={form.returnMode === 'custom'} onChange={() => set('returnMode', 'custom')} />
            <span>Custom window</span>
            {form.returnMode === 'custom' && <span className="pf-radio-input"><NumberInput integer value={form.returnDays} onChange={v => set('returnDays', v)} suffix="days" min={1} max={365} aria-label="Return window in days" invalid={!!errors.returnDays} /></span>}
          </label>
          <label className="pf-radio">
            <input type="radio" name="return-mode" checked={form.returnMode === 'none'} onChange={() => set('returnMode', 'none')} />
            <span>Not returnable</span>
          </label>
          {errors.returnDays && <div className="adm-error" role="alert">{errors.returnDays}</div>}
        </fieldset>

        <FieldRow cols={2}>
          <Field label="GST rate override" optional error={errors.gst_rate} hint={`Leave blank to use ${gst}% (${gstSource}).`}>
            <NumberInput value={form.gst_rate} onChange={v => set('gst_rate', v)} suffix="%" placeholder={`${gst}`} />
          </Field>
          <Field label="HSN code" optional error={errors.hsn_code} hint={hsn ? 'Leave blank to use the category’s code.' : 'Printed on the GST invoice.'}>
            <TextInput value={form.hsn_code} onChange={v => set('hsn_code', v.replace(/\D/g, ''))} maxLength={8} inputMode="numeric" placeholder={hsn || 'e.g. 6109'} />
          </Field>
        </FieldRow>
        <FieldRow cols={2}>
          <Field label="Maximum per order" required error={errors.max_qty_per_order} hint="Most units one customer can buy in one order."><NumberInput integer value={form.max_qty_per_order} onChange={v => set('max_qty_per_order', v)} min={1} max={1000} /></Field>
          <Field label="Low-stock level" optional error={errors.low_stock_threshold} hint={`Flag the product when stock falls to this. Leave blank for the store default (${Number(brand.low_stock_threshold) >= 0 ? brand.low_stock_threshold : 5}).`}>
            <NumberInput integer value={form.low_stock_threshold} onChange={v => set('low_stock_threshold', v)} suffix="units" placeholder={String(Number(brand.low_stock_threshold) >= 0 ? brand.low_stock_threshold : 5)} />
          </Field>
        </FieldRow>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────── Visibility & merchandising
export function VisibilityCard({ form, set, errors, isNew }) {
  const cur = STATUSES.find(s => s.value === form.status) || STATUSES[0];
  return (
    <Card title="Visibility">
      <div className="adm-stack">
        <Field label="Status" hint={cur.help}>
          <Select value={form.status} onChange={v => set('status', v)} options={STATUSES.map(s => ({ value: s.value, label: s.label }))} />
        </Field>
        {isNew && form.status === 'active' && <div className="adm-note info">A new product is saved as a draft first and goes live only once everything else has saved.</div>}
        <Toggle checked={form.featured} onChange={v => set('featured', v)} label="Featured" hint="Eligible for the “featured” shelves on the home page." />
        <Field label="Badge" optional error={errors.badge} hint="A short label on the product card, e.g. Bestseller or New.">
          <TextInput value={form.badge} onChange={v => set('badge', v)} maxLength={LIMITS.badge} placeholder="e.g. Bestseller" suffix={`${form.badge.length}/${LIMITS.badge}`} />
        </Field>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────────────── Search appearance
export function SeoCard({ form, set, errors, productId }) {
  const title = form.meta_title.trim() || form.name.trim() || 'Product name';
  const desc = form.meta_description.trim() || form.description.trim() || form.subtitle.trim() || 'The description search engines show under the title.';
  const host = typeof window !== 'undefined' ? window.location.host : 'yourstore.com';
  return (
    <Card title="Search appearance" subtitle="How this product can look on Google. Leave blank to use the name and description.">
      <div className="adm-stack">
        <div className="pf-snippet" aria-label="Search result preview">
          <div className="pf-snippet-url">{host} › product › {productId ? productId.slice(0, 8) : 'new'}</div>
          <div className="pf-snippet-title">{clip(title, 62)}</div>
          <div className="pf-snippet-desc">{clip(desc, 160)}</div>
        </div>
        <Field label="Page title" optional error={errors.meta_title}>
          <TextInput value={form.meta_title} onChange={v => set('meta_title', v)} maxLength={LIMITS.metaTitle} placeholder={form.name || 'Defaults to the product name'} suffix={`${form.meta_title.length}/${LIMITS.metaTitle}`} />
        </Field>
        <Field label="Meta description" optional error={errors.meta_description}>
          <Textarea rows={3} value={form.meta_description} onChange={v => set('meta_description', v)} maxLength={LIMITS.metaDescription} showCount placeholder="One or two sentences that make someone click." />
        </Field>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────── Storefront preview
export function PreviewCard({ form }) {
  const live = form.variants.filter(v => v.active !== false && String(v.price).trim() !== '' && Number.isFinite(Number(v.price)));
  const prices = live.map(v => Number(v.price));
  const from = prices.length ? Math.min(...prices) : null;
  const to = prices.length ? Math.max(...prices) : null;
  const cheapest = live.find(v => Number(v.price) === from);
  const mrp = cheapest && Number(cheapest.mrp) > from ? Number(cheapest.mrp) : null;
  const off = mrp ? discountPercent(from, mrp) : 0;
  const soldOut = live.length > 0 && live.every(v => v.track_inventory !== false && !(Number(v.stock) > 0));
  const img = form.images[0];
  return (
    <Card title="Store preview" subtitle="How it looks in a product grid.">
      <article className={`pf-pcard${soldOut ? ' is-out' : ''}`} aria-label="Product card preview">
        <div className="pf-pcard-media">
          {img ? <img src={img} alt="" style={{ objectPosition: form.image_position || '50% 50%' }} /> : <span className="pf-pcard-empty">No photo yet</span>}
          {form.badge.trim() && !soldOut && <span className="pf-pcard-badge">{form.badge.trim()}</span>}
          {soldOut && <span className="pf-pcard-sold">Out of stock</span>}
        </div>
        <div className="pf-pcard-body">
          {form.brand.trim() && <div className="pf-pcard-brand">{form.brand.trim()}</div>}
          <div className="pf-pcard-name">{form.name.trim() || 'Product name'}</div>
          {from !== null ? (
            <div className="pf-pcard-price">
              {to > from && <span className="pf-pcard-from">from </span>}<b>{formatMoney(from)}</b>
              {mrp && <s>{formatMoney(mrp)}</s>}{off >= 1 && <em>{off}% off</em>}
            </div>
          ) : <div className="pf-pcard-price adm-muted">Add a price</div>}
          {form.free_shipping && !soldOut && <div className="pf-pcard-note">Free delivery</div>}
        </div>
      </article>
    </Card>
  );
}
