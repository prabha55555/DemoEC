import React, { useState, useEffect, useId } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../context/AuthContext';
import { useBrand } from '../context/BrandContext';
import { useNavigate } from 'react-router-dom';
import { fmt, fmtDate, fmtDateTime, formatDeliveryLabel, categories, CATEGORY_GROUPS, COLLECTOR_LABEL, COMING_SOON_CATEGORIES, effectivePrice, isProductSoldOut, effectiveTaxonomy, knownStock } from '../data/products';
import { CARE_GUIDES_DEFAULT } from '../data/careGuides';
import ImageUploader from '../components/ImageUploader';
import SlidePreview from '../components/SlidePreview';
import { thumb } from '../utils/thumbnail';
import { withTimeout } from '../utils/withTimeout';
import { safeQuery, isAuthExpiredError } from '../utils/safeFetch';
import { uploadToStorage, deleteFromStorage } from '../utils/supabaseStorage';
import { DEFAULT_GIFTCARD_MIN } from '../utils/pricing';
import { safeHref } from '../utils/safeUrl';
import { HERO_CTA_POSITION_GRID, HERO_HEADLINE_SIZE_OPTIONS, HERO_SUBTEXT_SIZE_OPTIONS } from '../utils/heroCtaPositions';
import { EMAIL_EVENTS, EMAIL_EVENT_TYPES, emailEventLabel } from '../utils/emailEvents';
import { BLOCK_TYPES, emptyBlock } from '../utils/emailBlocks';
import { EMAIL_VARIABLE_KEYS, SUPPORT_VARIABLE_KEYS, variablesForEvent } from '../utils/emailVariables';
import { WHATSAPP_EVENTS, ORDER_WHATSAPP_EVENT_TYPES, whatsappEventLabel } from '../utils/whatsappEvents';
import { WHATSAPP_VARIABLE_KEYS } from '../utils/whatsappVariables';
import toast from 'react-hot-toast';
import brandMark from '../assets/brightlight-mark.png';
import '../styles/admin.css';

// estimated_delivery can hold either an admin-set exact date or an auto-generated
// range label like "20 Aug – 25 Aug" (no year, not parseable) — never assume it's
// a valid date string.
function toDateInputValue(str) {
  if (!str) return '';
  const d = new Date(str);
  return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
}

const CATS = categories.filter(c => c !== 'All');
// Same shape as the static `categories` export, but built from whatever taxonomy is
// currently active (admin-customized via Brand Settings, or the built-in default).
function categoriesFor(groups) {
  return [...groups.flatMap(g => g.items), COLLECTOR_LABEL];
}
const STATUSES = ['Pending', 'Paid', 'Confirmed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'];
const ENQUIRY_STATUSES = ['Received', 'Contacted', 'Quoted', 'Closed'];

// Client-side only -- builds a CSV string from already-fetched/filtered rows
// and triggers a browser download. No backend, no new endpoint; exports
// exactly what's currently on screen (post-filter), not the whole table.
function downloadCsv(filename, columns, rows) {
  const escapeCell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    // SEC-XSS-1: Excel/Sheets reads a leading =, +, -, @, tab or CR as the
    // start of a formula when this CSV is later opened there -- a stored
    // product/customer name/address starting with one of those (accidental
    // or deliberate) could then execute as a formula on whoever opens the
    // export. A leading apostrophe forces plain-text interpretation instead.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    columns.map(c => escapeCell(c.label)).join(','),
    ...rows.map(row => columns.map(c => escapeCell(c.get(row))).join(',')),
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// A product already gets its own distinct "Last 1" badge at stock===1 --
// this only adds visibility for stock===2 (the one level not already called
// out anywhere), while still counting stock 1 as "low" for the Dashboard's
// aggregate tile, since it obviously is.
const LOW_STOCK_THRESHOLD = 2;
function isLowStock(p) {
  if (isProductSoldOut(p)) return false;
  if (Array.isArray(p.variants) && p.variants.length > 0) {
    return p.variants.some(v => { const s = knownStock(v.stock); return s !== null && s > 0 && s <= LOW_STOCK_THRESHOLD; });
  }
  const s = knownStock(p.stock);
  return s !== null && s > 0 && s <= LOW_STOCK_THRESHOLD;
}
// Templates selectable from Orders > "Set & Notify" -- SUPPORT_REPLY resolves
// against an enquiry row, not an order, so it's excluded here (also enforced
// server-side in api/send-order-email.js). Order status -> a suggested
// (pre-selected, not forced) template event, since the admin still picks.
const ORDER_EMAIL_EVENT_TYPES = ['ORDER_CONFIRMED', 'ORDER_SHIPPED', 'ORDER_DELIVERED', 'REFUND_PROCESSED'];
const SUGGESTED_EVENT_BY_STATUS = { Shipped: 'ORDER_SHIPPED', 'Out for Delivery': 'ORDER_SHIPPED', Delivered: 'ORDER_DELIVERED', Cancelled: 'REFUND_PROCESSED' };
const SUGGESTED_WA_EVENT_BY_STATUS = { Shipped: 'ORDER_SHIPPED', 'Out for Delivery': 'ORDER_SHIPPED', Delivered: 'ORDER_DELIVERED' };
const SETTINGS_TABS = ['General', 'Home Page', 'Images', 'Videos', 'Masters', 'Help Guides', 'Delivery'];
const EMPTY = { name: '', product_number: '', cat: CATS[0], subtitle: '', origin: '', material: '', dimensions: '', weight: '', price: '', shipping_charge: '', show_shipping_at_checkout: true, story: '', together: '', badge: '', badge2: '', enquiry_only: false, stock: 1, available: true, featured: false, discover_pinned: false, is_collectors_piece: false, allow_enquiry: true, bg: 'linear-gradient(145deg,#F1F3F9,#DCE9E6)', images: [], image_position: '50% 50%', pinterest_url: '', variants: [], delivery_min_days: 5, delivery_max_days: 8, fulfillment_type: 'ready_to_ship', video_url: '', video_position: 0 };

// Paste-URL input + direct-upload button (Supabase Storage), for any single logo/hero/video field
function MediaUrlField({ value, onChange, onSave, placeholder, accept = 'image/*', inputStyle, saveLabel = 'Save', folder = 'brand' }) {
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef();

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadToStorage(file, folder);
      onSave(url);
      toast.success('Uploaded.');
    } catch (err) { toast.error('Upload failed: ' + err.message); }
    finally { setUploading(false); e.target.value = ''; }
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...inputStyle, flex: 1, minWidth: 180 }}
        onFocus={e => e.target.style.borderColor = 'var(--gd)'}
        onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'}
      />
      <button onClick={() => onSave(value)} style={{ background: 'var(--gd)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '10px 16px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{saveLabel}</button>
      <input ref={fileRef} type="file" accept={accept} style={{ display: 'none' }} onChange={handleFile} />
      <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ background: uploading ? '#A9C5BF' : 'var(--adm-fill-2)', border: '1px dashed var(--adm-border-strong)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '10px 16px', cursor: uploading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
        {uploading ? 'Uploading…' : 'Upload File'}
      </button>
    </div>
  );
}

// Photo of the actual packed order, per order -- see updatePackageImage()'s own
// comment for why this exists (sent via WhatsApp in place of the generic product
// photo for Shipped/Delivered notifications).
function PackagePhotoField({ order, onSave }) {
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef();
  const btnStyle = { background: 'var(--adm-fill-2)', border: '1px dashed var(--adm-border-strong)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11.5,  padding: '7px 12px', cursor: 'pointer', whiteSpace: 'nowrap' };

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadToStorage(file, 'orders');
      await onSave(order.id, url);
    } catch (err) { toast.error('Upload failed: ' + err.message); }
    finally { setUploading(false); e.target.value = ''; }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {order.package_image_url && <img src={order.package_image_url} alt="Packed order" style={{ width: 40, height: 40, objectFit: 'cover', border: '1px solid var(--adm-border-strong)' }} />}
      <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ ...btnStyle, opacity: uploading ? 0.6 : 1, cursor: uploading ? 'not-allowed' : 'pointer' }}>
        {uploading ? 'Uploading…' : order.package_image_url ? 'Replace Photo' : 'Upload Package Photo'}
      </button>
      {order.package_image_url && !uploading && (
        <button onClick={() => onSave(order.id, null)} style={{ background: 'none', border: 'none', color: 'var(--error)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11.5,  cursor: 'pointer', padding: 0 }}>Remove</button>
      )}
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
    </div>
  );
}

// Free-text carrier + tracking number/URL, entered by the admin once an order
// actually ships -- Phase 5. Deliberately no hardcoded courier dropdown: this
// business isn't tied to a fixed set of couriers, and a free-text field never
// needs a code change to support a new one. Local draft state (not written on
// every keystroke) mirrors PackagePhotoField's pattern just above -- one
// explicit Save, one loading state, no unsaved-partial writes.
function TrackingFields({ order, onSave }) {
  const [carrier, setCarrier] = React.useState(order.shipping_carrier || '');
  const [trackingNumber, setTrackingNumber] = React.useState(order.tracking_number || '');
  const [trackingUrl, setTrackingUrl] = React.useState(order.tracking_url || '');
  const [saving, setSaving] = React.useState(false);
  // Order rows are re-fetched/replaced wholesale (retryOrders / setOrders map),
  // not patched field-by-field into this component's own state -- without
  // resyncing, a save from a moment ago (or a value loaded from a fresh
  // fetchSection call) would never be reflected in these inputs.
  React.useEffect(() => {
    setCarrier(order.shipping_carrier || '');
    setTrackingNumber(order.tracking_number || '');
    setTrackingUrl(order.tracking_url || '');
  }, [order.shipping_carrier, order.tracking_number, order.tracking_url]);

  const fieldStyle = { background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', padding: '8px 12px', fontFamily: 'var(--font-body)', fontSize: 15, outline: 'none', width: 180 };

  async function handleSave() {
    if (saving) return; // double-click protection
    setSaving(true);
    try {
      await onSave(order.id, { shipping_carrier: carrier.trim() || null, tracking_number: trackingNumber.trim() || null, tracking_url: trackingUrl.trim() || null });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div>
        <label style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11,  color: 'var(--adm-muted)',  display: 'block', marginBottom: 4 }}>Carrier</label>
        <input value={carrier} onChange={e => setCarrier(e.target.value)} placeholder="e.g. Delhivery" style={fieldStyle} />
      </div>
      <div>
        <label style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11,  color: 'var(--adm-muted)',  display: 'block', marginBottom: 4 }}>Tracking Number</label>
        <input value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)} placeholder="e.g. 1234567890" style={{ ...fieldStyle, wordBreak: 'break-all' }} />
      </div>
      <div>
        <label style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11,  color: 'var(--adm-muted)',  display: 'block', marginBottom: 4 }}>Tracking URL</label>
        <input value={trackingUrl} onChange={e => setTrackingUrl(e.target.value)} placeholder="https://..." style={{ ...fieldStyle, width: 220 }} />
      </div>
      <button onClick={handleSave} disabled={saving} style={{ background: saving ? '#A9C5BF' : 'var(--gd)', border: 'none', color: 'var(--text-dark)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  padding: '8px 16px', cursor: saving ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>{saving ? 'Saving…' : 'Save Tracking'}</button>
    </div>
  );
}

// 3x3 focal-point grid — maps a friendly label to a CSS object-position value
const IMAGE_POSITIONS = [
  ['Top Left', '0% 0%'],   ['Top', '50% 0%'],    ['Top Right', '100% 0%'],
  ['Left', '0% 50%'],      ['Center', '50% 50%'], ['Right', '100% 50%'],
  ['Bottom Left', '0% 100%'], ['Bottom', '50% 100%'], ['Bottom Right', '100% 100%'],
];

function PositionGrid({ pos, onChange, size = 32 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(3,${size}px)`, gridTemplateRows: `repeat(3,${size}px)`, gap: 4 }}>
      {IMAGE_POSITIONS.map(([label, val]) => (
        <button key={val} type="button" title={label} onClick={() => onChange(val)} style={{
          width: size, height: size, border: '1px solid var(--adm-border-strong)', cursor: 'pointer',
          background: pos === val ? 'var(--gd)' : 'var(--adm-fill)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
        }}>
          <span style={{ width: size * 0.19, height: size * 0.19, borderRadius: '50%', background: pos === val ? '#fff' : '#A9C5BF' }} />
        </button>
      ))}
    </div>
  );
}

function ImagePositionPicker({ image, value, onChange, aspect = '1/1', width = 320 }) {
  const pos = value || '50% 50%';
  const [expanded, setExpanded] = React.useState(false);
  return (
    <div>
      <label style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--adm-muted)',  display: 'block', marginBottom: 7 }}>
        Image Focal Point — which part of the photo should stay visible when cropped
      </label>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Shows the FULL photo, uncropped -- a focal-point picker that hides part of the
            photo behind its own preview crop defeats the point of picking a focal point. */}
        <div onClick={() => image && setExpanded(true)} style={{ width: `min(${width}px, 100%)`, maxHeight: 420, position: 'relative', border: '1px solid var(--adm-border-strong)', overflow: 'hidden', background: 'var(--card)', cursor: image ? 'zoom-in' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {image ? (
            <img src={image} alt="" style={{ display: 'block', maxWidth: '100%', maxHeight: 420, width: 'auto', height: 'auto', objectFit: 'contain' }} />
          ) : (
            <div style={{ width: '100%', height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)', fontSize: 15, fontStyle: 'normal', color: 'var(--adm-muted)', textAlign: 'center', padding: 20 }}>Add an image to preview crop</div>
          )}
          {image && <div style={{ position: 'absolute', bottom: 6, right: 6, background: 'var(--adm-fill-2)', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '3px 7px' }}>Click to enlarge</div>}
        </div>
        <PositionGrid pos={pos} onChange={onChange} />
      </div>

      {expanded && (
        <div onClick={() => setExpanded(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(21,24,38,.82)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', border: '1px solid var(--adm-border)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', padding: 28, display: 'flex', gap: 28, alignItems: 'flex-start', maxWidth: '92vw', maxHeight: '92vh', overflow: 'auto' }}>
            <div style={{ maxWidth: 'min(70vw, 760px)', maxHeight: '80vh', position: 'relative', overflow: 'hidden', border: '1px solid var(--line)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--card)' }}>
              <img src={image} alt="" style={{ display: 'block', maxWidth: 'min(70vw, 760px)', maxHeight: '80vh', width: 'auto', height: 'auto', objectFit: 'contain' }} />
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  color: 'var(--gd)',  marginBottom: 16 }}>Set Focal Point</div>
              <PositionGrid pos={pos} onChange={onChange} size={54} />
              {/* Live-cropped preview, updates the instant a dot is clicked -- the grid
                  alone only shows which dot is selected, not what the actual crop looks
                  like, which is what an admin picking a focal point actually needs to see. */}
              <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  color: 'var(--adm-muted)',  marginTop: 22, marginBottom: 8 }}>Crop Preview</div>
              <div style={{ width: 280, aspectRatio: aspect, position: 'relative', overflow: 'hidden', border: '1px solid var(--line)', background: 'var(--card)' }}>
                {image && <img src={image} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: pos }} />}
              </div>
              <button onClick={() => setExpanded(false)} style={{ marginTop: 20, background: 'var(--gd)', border: 'none', color: 'var(--text-dark)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '11px 22px', cursor: 'pointer' }}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Reusable hero image upload block. Hoisted to module scope (was previously
// declared INSIDE BrandSettings' own render body) -- a component declared
// inside another component's render is a fresh function identity every
// render, so React treated every keystroke in heroUrls' state (which lives
// in BrandSettings and re-renders it) as "a different component type" and
// fully unmounted+remounted this whole subtree, including the <input>,
// losing focus after every single character. Everything it used to read via
// closure is now passed explicitly as props instead.
const heroFieldSection = { background: 'var(--adm-fill)', border: '1px solid var(--adm-border)', padding: '24px 22px', display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 16 };
const heroFieldSecHead = { fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--adm-body)', marginBottom: 4 };
const heroFieldHelpText = { fontFamily: 'var(--font-body)', fontSize: 14.5, fontStyle: 'normal', color: 'var(--adm-muted)' };
const heroFieldInp = { width: '100%', padding: '10px 12px', background: 'var(--adm-fill)', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontSize: 16, outline: 'none', caretColor: 'var(--gd)' };

function HeroImageField({ field, title, description, aspect = '16/5', mobileAspect, brand, heroUrls, onUrlChange, onSave, onRemove, onPositionChange }) {
  return (
    <div style={heroFieldSection}>
      <div style={heroFieldSecHead}>{title}</div>
      <div style={heroFieldHelpText}>{description}</div>
      {brand[field] && (
        <ImagePositionPicker image={brand[field]} value={brand[`${field}_position`]} onChange={v => onPositionChange(field, v)} aspect={aspect} width={aspect === '3/4' ? 260 : 460} />
      )}
      {brand[field] && mobileAspect && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11.5,  color: 'var(--gd)',  marginBottom: 4 }}>Mobile Crop</div>
          <div style={heroFieldHelpText}>How this photo crops on phones — kept separate from the desktop crop above so the subject isn't cut off on a narrow screen.</div>
          <ImagePositionPicker image={brand[field]} value={brand[`${field}_mobile_position`]} onChange={v => onPositionChange(`${field}_mobile`, v)} aspect={mobileAspect} width={260} />
        </div>
      )}
      <MediaUrlField
        value={heroUrls[field]}
        onChange={v => onUrlChange(field, v)}
        onSave={url => onSave(field, url)}
        placeholder="Paste an image URL..."
        inputStyle={heroFieldInp}
      />
      {brand[field] && <button onClick={() => onRemove(field)} style={{ marginTop: 8, background: 'none', border: '1px solid rgba(192,53,43,.4)', color: 'var(--error)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5,  padding: '5px 12px', cursor: 'pointer', alignSelf: 'flex-start' }}>Remove Image</button>}
    </div>
  );
}

// Dedicated mobile-only hero photo (a different image file entirely, not
// just a re-crop of the desktop one) -- optional. Without one, the page
// just keeps using the desktop image + mobile crop position as before.
function MobileHeroImageField({ field, title, brand, heroUrls, onUrlChange, onSave, onRemove }) {
  const mobileField = `${field}_mobile_image`;
  return (
    <div style={heroFieldSection}>
      <div style={heroFieldSecHead}>{title} — Mobile Image</div>
      <div style={heroFieldHelpText}>Optional. A separate photo shown only on phone screens, in place of the desktop image above. Upload something already composed for a tall, narrow frame.</div>
      {brand[mobileField] && <img src={thumb(brand[mobileField], 400)} alt="" style={{ width: '100%', maxWidth: 220, display: 'block', border: '1px solid var(--adm-border)' }} />}
      <MediaUrlField
        value={heroUrls[mobileField] || ''}
        onChange={v => onUrlChange(mobileField, v)}
        onSave={url => onSave(mobileField, url)}
        placeholder="Paste an image URL..."
        inputStyle={heroFieldInp}
      />
      {brand[mobileField] && <button onClick={() => onRemove(mobileField)} style={{ marginTop: 8, background: 'none', border: '1px solid rgba(192,53,43,.4)', color: 'var(--error)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5,  padding: '5px 12px', cursor: 'pointer', alignSelf: 'flex-start' }}>Remove Image</button>}
    </div>
  );
}

// ── INSIGHTS MANAGER (stories table) ────────────────────────────────────────
const EMPTY_STORY = { title: '', subtitle: '', category: 'Company News', author: 'Brightlight Solutions', story: '', images: [], published: true };
const STORY_CATS = ['Company News', 'New Arrivals', 'Shopping Guides', 'How-To Guides'];

function StoriesManager() {
  const [stories, setStories] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [view, setView] = React.useState('list'); // 'list' or 'edit'
  const [form, setForm] = React.useState({ ...EMPTY_STORY });
  const [editId, setEditId] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const navigate = useNavigate();

  React.useEffect(() => { fetchStories(); }, []);

  async function fetchStories() {
    setLoading(true);
    const { data, error, timedOut } = await safeQuery(supabase.from('stories').select('*').order('created_at', { ascending: false }));
    if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
    if (timedOut) toast.error('Timed out loading insights -- check your connection and try again.');
    else if (error) toast.error('Failed to load insights: ' + error.message);
    if (data) setStories(data);
    setLoading(false);
  }

  function setF(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function startNew() { setForm({ ...EMPTY_STORY }); setEditId(null); setView('edit'); }
  function startEdit(s) { setForm({ ...s }); setEditId(s.id); setView('edit'); }

  async function saveStory() {
    if (!form.title.trim()) { toast.error('Title is required.'); return; }
    setSaving(true);
    try {
      const payload = { ...form, updated_at: new Date().toISOString() };
      // Supabase resolves (doesn't throw) on a query/RLS error, so the error must
      // be checked explicitly -- otherwise a blocked write still shows "saved."
      // Timeboxed the same way the reads on this tab already are -- a stalled
      // connection here used to leave the Save button spinning forever with no
      // error and no way out short of a refresh.
      const { error, timedOut } = editId
        ? await safeQuery(supabase.from('stories').update(payload).eq('id', editId))
        : await safeQuery(supabase.from('stories').insert(payload));
      if (timedOut) throw new Error('Timed out -- check your connection and try again.');
      if (error) throw error;
      toast.success(editId ? 'Insight updated.' : 'Insight published.');
      await fetchStories();
      setView('list');
    } catch (e) { toast.error(e.message || 'Failed to save insight.'); }
    finally { setSaving(false); }
  }

  async function deleteStory(story) {
    if (!window.confirm('Delete this insight permanently?')) return;
    const { error, timedOut } = await safeQuery(supabase.from('stories').delete().eq('id', story.id));
    if (timedOut) { toast.error('Timed out deleting insight -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed to delete insight.'); return; }
    deleteFromStorage(story.images);
    toast.success('Insight deleted.');
    fetchStories();
  }

  async function togglePublish(s) {
    const { error, timedOut } = await safeQuery(supabase.from('stories').update({ published: !s.published }).eq('id', s.id));
    if (timedOut) { toast.error('Timed out -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed to update insight.'); return; }
    fetchStories();
  }

  const lbl = { fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--adm-muted)',  display: 'block', marginBottom: 7 };
  const inp = { width: '100%', padding: '10px 12px', background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontSize: 14.5, outline: 'none', caretColor: 'var(--gd)' };

  // ── LIST VIEW ──
  if (view === 'list') {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  color: 'var(--gd)' }}>Insights ({stories.length})</div>
          <button onClick={startNew} style={{ background: 'var(--gd)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '9px 18px', cursor: 'pointer' }}>Add New Insight</button>
        </div>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner"></span></div>
        ) : stories.length === 0 ? (
          <AdminEmpty icon="doc" title="No blog posts yet" hint="Click &quot;Add New Insight&quot; to publish your first one." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {stories.map(s => (
              <div key={s.id} className="admin-story-row" style={{ background: 'var(--adm-fill)', border: '1px solid var(--adm-border)', padding: '16px 18px', display: 'flex', gap: 16, alignItems: 'center' }}>
                {s.images?.[0] && <img src={thumb(s.images[0], 130)} alt="" loading="lazy" decoding="async" style={{ width: 64, height: 64, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--adm-border-strong)' }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  color: 'var(--gd)', background: 'var(--adm-fill-2)', padding: '2px 8px' }}>{s.category}</span>
                    <span className={`adm-badge ${s.published ? 'success' : 'neutral'}`}>{s.published ? 'Published' : 'Draft'}</span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 17, color: 'var(--iv)', marginBottom: 2 }}>{s.title}</div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--adm-muted)', fontStyle: 'normal' }}>{s.author} · {fmtDate(s.created_at)}</div>
                </div>
                <div className="admin-story-actions" style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => togglePublish(s)} style={{ background: 'none', border: '1px solid var(--adm-border-strong)', color: 'var(--adm-muted)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  padding: '7px 12px', cursor: 'pointer' }}>{s.published ? 'Unpublish' : 'Publish'}</button>
                  <button onClick={() => startEdit(s)} style={{ background: 'var(--gd)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  padding: '7px 12px', cursor: 'pointer' }}>Edit</button>
                  <button onClick={() => deleteStory(s)} style={{ background: 'none', border: '1px solid rgba(192,53,43,.4)', color: 'var(--error)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  padding: '7px 12px', cursor: 'pointer' }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── EDIT/ADD VIEW ──
  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  color: 'var(--gd)' }}>{editId ? 'Edit Insight' : 'New Insight'}</div>
        <button onClick={() => setView('list')} style={{ background: 'transparent', border: '1px solid var(--adm-border-strong)', color: 'var(--adm-muted)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '8px 16px', cursor: 'pointer' }}>Back to List</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div><label style={lbl}>Title *</label><input style={inp} value={form.title} onChange={e => setF('title', e.target.value)} placeholder="e.g. 5 tips for choosing the right size online" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>

        <div><label style={lbl}>Subtitle</label><input style={inp} value={form.subtitle} onChange={e => setF('subtitle', e.target.value)} placeholder="One-line summary shown under the title" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>

        <div className="admin-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label style={lbl}>Category</label>
            <select style={{ ...inp, cursor: 'pointer' }} value={form.category} onChange={e => setF('category', e.target.value)}>
              {STORY_CATS.map(c => <option key={c} value={c} style={{ background: '#fff' }}>{c}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Author</label><input style={inp} value={form.author} onChange={e => setF('author', e.target.value)} onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
        </div>

        <div>
          <label style={lbl}>Article Text</label>
          <textarea style={{ ...inp, minHeight: 180, resize: 'vertical', lineHeight: 1.7 }} value={form.story} onChange={e => setF('story', e.target.value)} placeholder="Write the full article here..." onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} />
        </div>

        <ImageUploader key={editId || 'new'} images={form.images} onChange={imgs => setF('images', imgs)} folder="stories" />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" checked={form.published} onChange={e => setF('published', e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--gd)' }} />
          <label style={{ fontFamily: 'var(--font-body)', fontSize: 16, color: 'var(--iv)' }}>Published (visible on the public Insights page)</label>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button onClick={saveStory} disabled={saving} style={{ background: 'var(--gd)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '13px 28px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving...' : editId ? 'Update Insight' : 'Publish Insight'}
          </button>
          {editId && <button onClick={() => { setForm({ ...EMPTY_STORY }); setEditId(null); setView('list'); }} style={{ background: 'transparent', border: '1px solid var(--adm-border-strong)', color: 'var(--adm-muted)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '13px 28px', cursor: 'pointer' }}>Cancel</button>}
        </div>
      </div>
    </div>
  );
}

// ── HERO SLIDES ────────────────────────────────────────────
const EMPTY_SLIDE = { image_url: '', image_position: '50% 50%', mobile_image_url: '', headline: '', headline_size: 'medium', mobile_headline_size: '', subtext: '', subtext_size: 'medium', cta_label: 'Shop Now', cta_link: '', cta_position: 'bottom-left', mobile_cta_position: '', show_cta: true, extra_ctas: [], display_order: 0, active: true };

// 3x3 visual grid for picking a content-block position -- same look as PositionGrid
// (the existing image focal-point picker above) but its buttons output a named
// preset key ('bottom-left') instead of a raw CSS object-position percentage,
// since HeroSlider/SlidePreview key off HERO_CTA_POSITIONS by name.
function CtaPositionGrid({ value, onChange, size = 40 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(3,${size}px)`, gridTemplateRows: `repeat(3,${size}px)`, gap: 4 }}>
      {HERO_CTA_POSITION_GRID.flat().map(key => (
        <button key={key} type="button" title={key.replace('-', ' ')} onClick={() => onChange(key)} style={{
          width: size, height: size, border: '1px solid var(--adm-border-strong)', cursor: 'pointer',
          background: value === key ? 'var(--gd)' : 'var(--adm-fill)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
        }}>
          <span style={{ width: size * 0.19, height: size * 0.19, borderRadius: '50%', background: value === key ? '#fff' : '#A9C5BF' }} />
        </button>
      ))}
    </div>
  );
}

function HeroSlidesManager() {
  const { brand, updateBrand, loading: brandLoading } = useBrand();
  const [slides, setSlides] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [view, setView] = React.useState('list');
  const [form, setForm] = React.useState({ ...EMPTY_SLIDE });
  const [editId, setEditId] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const dragIndex = React.useRef(null);
  const navigate = useNavigate();

  // Whole-slider settings (timing, dots, arrows) -- shared across every slide,
  // not a per-slide field, since they share one timer and one set of nav controls.
  const [sliderSeconds, setSliderSeconds] = React.useState(() => (Number(brand.hero_slider_interval_ms) || 4000) / 1000);
  const [showDots, setShowDots] = React.useState(brand.hero_slider_show_dots !== false);
  const [showArrows, setShowArrows] = React.useState(brand.hero_slider_show_arrows !== false);
  const [savingSliderSettings, setSavingSliderSettings] = React.useState(false);

  // Same "opened before BrandContext finished loading" hazard as GiftCardsManager
  // -- these three fields seed from brand at mount, which can still be the
  // pre-fetch placeholder, and never resynced. Resyncs once, the moment
  // BrandContext's fetch actually completes.
  const brandSyncedRef = React.useRef(!brandLoading);
  React.useEffect(() => {
    if (brandSyncedRef.current || brandLoading) return;
    brandSyncedRef.current = true;
    setSliderSeconds((Number(brand.hero_slider_interval_ms) || 4000) / 1000);
    setShowDots(brand.hero_slider_show_dots !== false);
    setShowArrows(brand.hero_slider_show_arrows !== false);
  }, [brandLoading, brand]);

  async function saveSliderSettings() {
    setSavingSliderSettings(true);
    try {
      await updateBrand({
        hero_slider_interval_ms: Math.max(1000, Math.round(Number(sliderSeconds) * 1000) || 4000),
        hero_slider_show_dots: showDots,
        hero_slider_show_arrows: showArrows,
      });
      toast.success('Slider settings saved.');
    } catch { toast.error('Failed to save. Run the hero_slider_* SQL migration in Supabase if this keeps failing.'); }
    finally { setSavingSliderSettings(false); }
  }

  React.useEffect(() => { fetchSlides(); }, []);

  async function fetchSlides() {
    setLoading(true);
    const { data, error, timedOut } = await safeQuery(supabase.from('hero_slides').select('*').order('display_order'));
    if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
    if (timedOut) toast.error('Timed out loading hero slides -- check your connection and try again.');
    else if (error) toast.error('Failed to load hero slides: ' + error.message);
    if (data) setSlides(data);
    setLoading(false);
  }

  function setF(key, val) { setForm(f => ({ ...f, [key]: val })); }
  function startNew() { setForm({ ...EMPTY_SLIDE, display_order: slides.length }); setEditId(null); setView('edit'); }
  function startEdit(s) { setForm({ ...EMPTY_SLIDE, ...s, extra_ctas: s.extra_ctas || [] }); setEditId(s.id); setView('edit'); }
  function addExtraCta() { setForm(f => ({ ...f, extra_ctas: [...(f.extra_ctas || []), { label: '', link: '' }] })); }
  function updateExtraCta(i, key, val) { setForm(f => ({ ...f, extra_ctas: f.extra_ctas.map((c, idx) => idx === i ? { ...c, [key]: val } : c) })); }
  function removeExtraCta(i) { setForm(f => ({ ...f, extra_ctas: f.extra_ctas.filter((_, idx) => idx !== i) })); }

  async function saveSlide() {
    if (!form.image_url) { toast.error('An image is required.'); return; }
    if (form.show_cta && !form.cta_link.trim()) { toast.error('CTA link is required when the CTA button is shown.'); return; }
    // SEC-XSS-3: a CTA link renders as a real <a href> on the live homepage --
    // reject anything safeHref() wouldn't allow there (javascript:, data:, a
    // bare "//host", ...) instead of saving it.
    if (form.show_cta && form.cta_link.trim() && !safeHref(form.cta_link.trim())) {
      toast.error('CTA link looks unsafe or invalid -- use a path like /shop, or a full https:// link.');
      return;
    }
    for (const c of (form.extra_ctas || [])) {
      if (c.link?.trim() && !safeHref(c.link.trim())) {
        toast.error(`"${c.label || 'Extra'}" button's link looks unsafe or invalid -- use a path like /shop, or a full https:// link.`);
        return;
      }
    }
    setSaving(true);
    try {
      const payload = { ...form, updated_at: new Date().toISOString() };
      // Supabase resolves (doesn't throw) on a query/RLS error, so the error must
      // be checked explicitly -- otherwise a blocked write still shows "saved."
      // Timeboxed the same way this tab's reads already are.
      const { error, timedOut } = editId
        ? await safeQuery(supabase.from('hero_slides').update(payload).eq('id', editId))
        : await safeQuery(supabase.from('hero_slides').insert(payload));
      if (timedOut) throw new Error('Timed out -- check your connection and try again.');
      if (error) throw error;
      toast.success(editId ? 'Slide updated.' : 'Slide added.');
      await fetchSlides();
      setView('list');
    } catch (e) { toast.error(e.message?.startsWith('Timed out') ? e.message : 'Failed to save. Run the hero_slides SQL migration in Supabase if this keeps failing.'); }
    finally { setSaving(false); }
  }

  async function deleteSlide(slide) {
    if (!window.confirm('Delete this slide permanently?')) return;
    const { error, timedOut } = await safeQuery(supabase.from('hero_slides').delete().eq('id', slide.id));
    if (timedOut) { toast.error('Timed out deleting slide -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed to delete slide.'); return; }
    deleteFromStorage(slide.image_url);
    toast.success('Slide deleted.');
    fetchSlides();
  }

  async function toggleActive(s) {
    const { error, timedOut } = await safeQuery(supabase.from('hero_slides').update({ active: !s.active }).eq('id', s.id));
    if (timedOut) { toast.error('Timed out -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed to update slide.'); return; }
    fetchSlides();
  }

  // Reindexes the full visible list to 0..n-1 and persists in one round trip --
  // used by both native drag-and-drop and the up/down arrow fallback (arrows exist
  // because native HTML5 DnD doesn't work on touch, and reordering shouldn't
  // depend on a mouse-capable admin device).
  async function persistOrder(reordered) {
    const withOrder = reordered.map((s, i) => ({ ...s, display_order: i }));
    setSlides(withOrder);
    const { error, timedOut } = await safeQuery(supabase.from('hero_slides').upsert(withOrder));
    if (timedOut) toast.error('Timed out saving new order -- check your connection and try again.');
    else if (error) toast.error('Failed to save new order.');
  }

  function moveSlide(idx, dir) {
    const target = idx + dir;
    if (target < 0 || target >= slides.length) return;
    const next = [...slides];
    [next[idx], next[target]] = [next[target], next[idx]];
    persistOrder(next);
  }

  function onDrop(idx) {
    if (dragIndex.current === null || dragIndex.current === idx) return;
    const next = [...slides];
    const [moved] = next.splice(dragIndex.current, 1);
    next.splice(idx, 0, moved);
    dragIndex.current = null;
    persistOrder(next);
  }

  const lbl = { fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--adm-muted)',  display: 'block', marginBottom: 7 };
  const inp = { width: '100%', padding: '10px 12px', background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontSize: 14.5, outline: 'none', caretColor: 'var(--gd)' };

  // ── LIST VIEW ──
  if (view === 'list') {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  color: 'var(--gd)' }}>Hero Slides ({slides.length})</div>
          <button onClick={startNew} style={{ background: 'var(--gd)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '9px 18px', cursor: 'pointer' }}>Add New Slide</button>
        </div>

        <div style={{ background: 'var(--adm-fill)', border: '1px solid var(--adm-border)', padding: '18px 20px', marginBottom: 20, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 20 }}>
          <div>
            <label style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  color: 'var(--adm-muted)',  display: 'block', marginBottom: 6 }}>Auto-Advance Speed (seconds)</label>
            <input type="number" min="1" step="0.5" value={sliderSeconds} onChange={e => setSliderSeconds(e.target.value)} style={{ width: 90, padding: '8px 10px', background: 'var(--adm-fill)', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontSize: 15, outline: 'none' }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={showDots} onChange={e => setShowDots(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
            <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  color: 'var(--iv)' }}>Show Slide Dots</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={showArrows} onChange={e => setShowArrows(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
            <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  color: 'var(--iv)' }}>Show Navigation Arrows</span>
          </label>
          <button onClick={saveSliderSettings} disabled={savingSliderSettings} style={{ background: 'var(--gd)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '9px 16px', cursor: 'pointer', opacity: savingSliderSettings ? 0.6 : 1 }}>
            {savingSliderSettings ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner"></span></div>
        ) : slides.length === 0 ? (
          <AdminEmpty icon="image" title="No banner slides yet" hint="Click &quot;Add New Slide&quot; to build the home page banner. Until a slide is active, the store shows its default banners." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {slides.map((s, i) => (
              <div key={s.id}
                draggable
                onDragStart={() => { dragIndex.current = i; }}
                onDragOver={e => e.preventDefault()}
                onDrop={() => onDrop(i)}
                style={{ background: 'var(--adm-fill)', border: '1px solid var(--adm-border)', padding: '16px 18px', display: 'flex', gap: 16, alignItems: 'center', cursor: 'grab' }}
              >
                <SlidePreview slide={s} width={110} height={62} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                    <span className={`adm-badge ${s.active ? 'success' : 'neutral'}`}>{s.active ? 'Active' : 'Inactive'}</span>
                    <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11, color: 'var(--adm-muted)' }}>Order {s.display_order}</span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 16, color: 'var(--iv)' }}>{s.headline || <em style={{ opacity: .5 }}>No headline</em>}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button onClick={() => moveSlide(i, -1)} disabled={i === 0} title="Move up" style={{ width: 22, height: 22, background: 'var(--adm-fill-2)', border: 'none', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><AdminIcon name="chevronUp" size={13} /></button>
                  <button onClick={() => moveSlide(i, 1)} disabled={i === slides.length - 1} title="Move down" style={{ width: 22, height: 22, background: 'var(--adm-fill-2)', border: 'none', cursor: i === slides.length - 1 ? 'default' : 'pointer', opacity: i === slides.length - 1 ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><AdminIcon name="chevronDown" size={13} /></button>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button onClick={() => toggleActive(s)} style={{ background: 'transparent', border: '1px solid var(--adm-border-strong)', color: 'var(--adm-muted)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11,  padding: '7px 12px', cursor: 'pointer' }}>{s.active ? 'Deactivate' : 'Activate'}</button>
                  <button onClick={() => startEdit(s)} style={{ background: 'transparent', border: '1px solid var(--adm-border-strong)', color: 'var(--adm-muted)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11,  padding: '7px 12px', cursor: 'pointer' }}>Edit</button>
                  <button onClick={() => deleteSlide(s)} className="btn-danger" style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11 }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── EDIT VIEW ──
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  color: 'var(--gd)' }}>{editId ? 'Edit Slide' : 'Add New Slide'}</div>
        <button onClick={() => setView('list')} style={{ background: 'transparent', border: '1px solid var(--adm-border-strong)', color: 'var(--adm-muted)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '8px 16px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}><AdminIcon name="arrowLeft" size={13} /> Back to List</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 980 }}>
        <ImageUploader label="Slide Image" multiple={false} images={form.image_url ? [form.image_url] : []} onChange={urls => setF('image_url', urls[urls.length - 1] || '')} folder="hero-slides" />

        <ImagePositionPicker image={form.image_url} value={form.image_position} onChange={pos => setF('image_position', pos)} aspect="16/7" width={360} />

        <div>
          <label style={lbl}>Mobile Image (optional)</label>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 14.5, fontStyle: 'normal', color: 'var(--adm-muted)', marginBottom: 8 }}>
            A vertical photo shown on phones instead of the image above &mdash; upload one already composed for a tall screen. If left empty, phones show the full image above uncropped instead of a guessed crop.
          </div>
          <ImageUploader label="Mobile Image" multiple={false} images={form.mobile_image_url ? [form.mobile_image_url] : []} onChange={urls => setF('mobile_image_url', urls[urls.length - 1] || '')} folder="hero-slides" />
        </div>

        <div>
          <label style={lbl}>Headline (optional, max 60 characters)</label>
          {/* textarea, not input -- Enter needs to insert an actual line break here so
              the admin controls exactly where the line splits, not just where the
              browser happens to wrap it. whiteSpace:'pre-line' on the live render is
              what makes that line break actually show up (see HeroSlider/SlidePreview). */}
          <textarea style={{ ...inp, resize: 'vertical', lineHeight: 1.4 }} rows={2} value={form.headline} maxLength={60} onChange={e => setF('headline', e.target.value)} placeholder={"e.g. New arrivals are here.\nPress Enter for a second line."} onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} />
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--adm-muted)', marginTop: 4, textAlign: 'right' }}>{form.headline.length}/60 · press Enter for a line break</div>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={lbl}>Headline Size (Desktop)</label>
            <select value={form.headline_size} onChange={e => setF('headline_size', e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
              {HERO_HEADLINE_SIZE_OPTIONS.map(s => <option key={s} value={s}>{s === 'xl' ? 'Extra Large' : s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={lbl}>Headline Size (Mobile)</label>
            <select value={form.mobile_headline_size || form.headline_size} onChange={e => setF('mobile_headline_size', e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
              {HERO_HEADLINE_SIZE_OPTIONS.map(s => <option key={s} value={s}>{s === 'xl' ? 'Extra Large' : s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
            {form.mobile_headline_size && (
              <button type="button" onClick={() => setF('mobile_headline_size', '')} style={{ marginTop: 8, background: 'none', border: 'none', color: 'var(--gd)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11,  cursor: 'pointer', padding: 0 }}>Reset to match desktop</button>
            )}
          </div>
        </div>

        <div>
          <label style={lbl}>Subtext (optional, max 120 characters)</label>
          <input style={inp} value={form.subtext} maxLength={120} onChange={e => setF('subtext', e.target.value)} placeholder="e.g. Fresh finds across every category." onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} />
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--adm-muted)', marginTop: 4, textAlign: 'right' }}>{form.subtext.length}/120</div>
        </div>

        <div>
          <label style={lbl}>Subtext Size</label>
          <select value={form.subtext_size} onChange={e => setF('subtext_size', e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
            {HERO_SUBTEXT_SIZE_OPTIONS.map(s => <option key={s} value={s}>{s === 'xl' ? 'Extra Large' : s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.show_cta} onChange={e => setF('show_cta', e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
          <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--iv)' }}>Show CTA Button</span>
        </label>

        {form.show_cta && (
          <>
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Button 1 Label</label>
                <input style={inp} value={form.cta_label} onChange={e => setF('cta_label', e.target.value)} placeholder="Shop Now" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Button 1 Link (required)</label>
                <input style={inp} value={form.cta_link} onChange={e => setF('cta_link', e.target.value)} placeholder="/shop or https://..." onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} />
              </div>
            </div>

            {(form.extra_ctas || []).map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Button {i + 2} Label</label>
                  <input style={inp} value={c.label} onChange={e => updateExtraCta(i, 'label', e.target.value)} placeholder="Learn More" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Button {i + 2} Link</label>
                  <input style={inp} value={c.link} onChange={e => updateExtraCta(i, 'link', e.target.value)} placeholder="/about or https://..." onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} />
                </div>
                <button type="button" onClick={() => removeExtraCta(i)} title="Remove button" style={{ background: 'none', border: '1px solid rgba(192,53,43,.4)', color: 'var(--error)', width: 42, height: 42, flexShrink: 0, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
              </div>
            ))}
            <button type="button" onClick={addExtraCta} style={{ background: 'none', border: '1px dashed var(--adm-border-strong)', color: 'var(--gd)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '9px 16px', cursor: 'pointer', marginTop: 4, alignSelf: 'flex-start' }}>+ Add Button</button>
          </>
        )}

        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <div>
            <label style={lbl}>Position (Desktop)</label>
            <CtaPositionGrid value={form.cta_position} onChange={pos => setF('cta_position', pos)} />
          </div>
          <div>
            <label style={lbl}>Position (Mobile)</label>
            <CtaPositionGrid value={form.mobile_cta_position || form.cta_position} onChange={pos => setF('mobile_cta_position', pos)} />
            {form.mobile_cta_position && (
              <button type="button" onClick={() => setF('mobile_cta_position', '')} style={{ marginTop: 8, background: 'none', border: 'none', color: 'var(--gd)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11,  cursor: 'pointer', padding: 0 }}>Reset to match desktop</button>
            )}
          </div>
        </div>

        <div>
          <label style={lbl}>Preview</label>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5,  color: 'var(--adm-muted)',  marginBottom: 6 }}>Desktop</div>
              <SlidePreview slide={form} width={360} height={200} />
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 10.5,  color: 'var(--adm-muted)',  marginBottom: 6 }}>Mobile</div>
              <SlidePreview slide={form} width={150} height={260} mobile />
            </div>
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.active} onChange={e => setF('active', e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
          <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--iv)' }}>Active (visible on the live site)</span>
        </label>

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button onClick={saveSlide} disabled={saving} style={{ background: 'var(--gd)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '13px 28px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving...' : editId ? 'Update Slide' : 'Add Slide'}
          </button>
          <button onClick={() => setView('list')} style={{ background: 'transparent', border: '1px solid var(--adm-border-strong)', color: 'var(--adm-muted)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '13px 28px', cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── COUPONS ────────────────────────────────────────────────
const EMPTY_COUPON = { code: '', type: 'percent', value: '', applies_to: 'all', product_ids: [], active: true, max_uses: '' };
const APPLIES_TO_LABEL = { all: 'All products', products: 'Specific product(s)', bundle: 'Bundle — buy together' };

function CouponsManager() {
  const [coupons, setCoupons] = React.useState([]);
  const [products, setProducts] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [productsLoading, setProductsLoading] = React.useState(true);
  const [view, setView] = React.useState('list');
  const [form, setForm] = React.useState({ ...EMPTY_COUPON });
  const [editId, setEditId] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const navigate = useNavigate();

  React.useEffect(() => { fetchCoupons(); fetchProducts(); }, []);

  async function fetchCoupons() {
    setLoading(true);
    const { data, error, timedOut } = await safeQuery(supabase.from('coupons').select('*').order('created_at', { ascending: false }));
    if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
    if (timedOut) toast.error('Timed out loading coupons -- check your connection and try again.');
    else if (error) toast.error('Failed to load coupons: ' + error.message);
    if (data) setCoupons(data);
    setLoading(false);
  }
  async function fetchProducts() {
    setProductsLoading(true);
    // Populates the "Select Product(s)" checklist when creating a coupon --
    // previously had no loading state at all, so a slow/failed request looked
    // identical to "there are genuinely no products," same class of bug as the
    // Dashboard's "0 products" issue, just never fixed here.
    const { data, error, timedOut } = await safeQuery(supabase.from('products').select('id, name').order('name'));
    if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
    if (timedOut) toast.error('Timed out loading products -- check your connection and try again.');
    else if (error) toast.error('Failed to load products: ' + error.message);
    if (data) setProducts(data);
    setProductsLoading(false);
  }

  function setF(key, val) { setForm(f => ({ ...f, [key]: val })); }
  function startNew() { setForm({ ...EMPTY_COUPON }); setEditId(null); setView('edit'); }
  function startEdit(c) { setForm({ ...EMPTY_COUPON, ...c, value: String(c.value), product_ids: c.product_ids || [], max_uses: c.max_uses ? String(c.max_uses) : '' }); setEditId(c.id); setView('edit'); }

  function toggleProduct(id) {
    setForm(f => ({ ...f, product_ids: f.product_ids.includes(id) ? f.product_ids.filter(x => x !== id) : [...f.product_ids, id] }));
  }

  function productNames(ids) {
    if (!ids?.length) return '—';
    return ids.map(id => products.find(p => p.id === id)?.name || '(deleted product)').join(', ');
  }

  async function saveCoupon() {
    const code = form.code.trim().toUpperCase();
    if (!code) { toast.error('Coupon code is required.'); return; }
    if (!form.value || Number(form.value) <= 0) { toast.error('Enter a discount value greater than 0.'); return; }
    if (form.type === 'percent' && Number(form.value) > 100) { toast.error('Percentage off can\'t be more than 100%.'); return; }
    if (form.applies_to !== 'all' && form.product_ids.length === 0) { toast.error('Select at least one product.'); return; }
    if (form.applies_to === 'bundle' && form.product_ids.length < 2) { toast.error('A bundle coupon needs at least 2 products selected.'); return; }
    if (form.max_uses !== '' && (!Number.isInteger(Number(form.max_uses)) || Number(form.max_uses) <= 0)) { toast.error('Max uses must be a whole number greater than 0, or left blank for unlimited.'); return; }
    setSaving(true);
    try {
      const payload = {
        code, type: form.type, value: Number(form.value),
        applies_to: form.applies_to, product_ids: form.applies_to === 'all' ? [] : form.product_ids,
        active: form.active,
        max_uses: form.max_uses === '' ? null : Number(form.max_uses),
      };
      if (editId) {
        const { error, timedOut } = await safeQuery(supabase.from('coupons').update(payload).eq('id', editId));
        if (timedOut) throw new Error('Timed out -- check your connection and try again.');
        if (error) throw error;
        toast.success('Coupon updated.');
      } else {
        const { error, timedOut } = await safeQuery(supabase.from('coupons').insert(payload));
        if (timedOut) throw new Error('Timed out -- check your connection and try again.');
        if (error) throw error;
        toast.success('Coupon created.');
      }
      await fetchCoupons();
      setView('list');
    } catch (e) {
      toast.error(e.message?.startsWith('Timed out') ? e.message : e.message?.includes('duplicate') ? 'That code already exists.' : 'Failed. Run the coupons SQL migration in Supabase if this keeps failing.');
    } finally { setSaving(false); }
  }

  async function deleteCoupon(id) {
    if (!window.confirm('Delete this coupon?')) return;
    const { error, timedOut } = await safeQuery(supabase.from('coupons').delete().eq('id', id));
    if (timedOut) { toast.error('Timed out deleting coupon -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed to delete coupon.'); return; }
    toast.success('Coupon deleted.');
    fetchCoupons();
  }

  async function toggleActive(c) {
    const { error, timedOut } = await safeQuery(supabase.from('coupons').update({ active: !c.active }).eq('id', c.id));
    if (timedOut) { toast.error('Timed out -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed to update coupon.'); return; }
    fetchCoupons();
  }

  const lbl = { fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--adm-muted)',  display: 'block', marginBottom: 7 };
  const inp = { width: '100%', padding: '10px 12px', background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontSize: 14.5, outline: 'none', caretColor: 'var(--gd)' };
  const helpText = { fontFamily: 'var(--font-body)', fontSize: 14.5, fontStyle: 'normal', color: 'var(--adm-muted)' };

  if (view === 'list') {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  color: 'var(--gd)' }}>Coupons ({coupons.length})</div>
          <button onClick={startNew} style={{ background: 'var(--gd)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '9px 18px', cursor: 'pointer' }}>Add New Coupon</button>
        </div>
        <div style={{ ...helpText, marginBottom: 20 }}>Coupon codes are validated server-side (at checkout, and by the "Apply" button) against this table -- eligibility, usage caps and the discount amount are always enforced by the server, never just trusted from the customer's browser.</div>
        {!loading && coupons.length > 0 && (
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--adm-muted)', marginBottom: 16 }}>
            {coupons.filter(c => c.active).length} active · {coupons.reduce((sum, c) => sum + (c.times_used || 0), 0)} total redemptions across all coupons
          </div>
        )}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner"></span></div>
        ) : coupons.length === 0 ? (
          <AdminEmpty icon="tag" title="No coupons yet" hint="Click &quot;Add New Coupon&quot; to create your first discount code." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {coupons.map(c => (
              <div key={c.id} style={{ background: 'var(--adm-fill)', border: '1px solid var(--adm-border)', padding: '16px 18px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 15,  color: 'var(--iv)' }}>{c.code}</span>
                    <span className={`adm-badge ${c.active ? 'success' : 'neutral'}`}>{c.active ? 'Active' : 'Inactive'}</span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 16, color: 'var(--iv)' }}>
                    {c.type === 'percent' ? `${c.value}% off` : `₹${Number(c.value).toLocaleString('en-IN')} off`} — {APPLIES_TO_LABEL[c.applies_to]}
                  </div>
                  {c.applies_to !== 'all' && <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--adm-muted)', fontStyle: 'normal', marginTop: 2 }}>{productNames(c.product_ids)}</div>}
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--adm-muted)', fontStyle: 'normal', marginTop: 2 }}>{c.max_uses ? `Used ${c.times_used || 0} of ${c.max_uses}` : 'Unlimited uses'}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => toggleActive(c)} style={{ background: 'none', border: '1px solid var(--adm-border-strong)', color: 'var(--adm-muted)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  padding: '7px 12px', cursor: 'pointer' }}>{c.active ? 'Deactivate' : 'Activate'}</button>
                  <button onClick={() => startEdit(c)} style={{ background: 'var(--gd)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  padding: '7px 12px', cursor: 'pointer' }}>Edit</button>
                  <button onClick={() => deleteCoupon(c.id)} style={{ background: 'none', border: '1px solid rgba(192,53,43,.4)', color: 'var(--error)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  padding: '7px 12px', cursor: 'pointer' }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  color: 'var(--gd)' }}>{editId ? 'Edit Coupon' : 'New Coupon'}</div>
        <button onClick={() => setView('list')} style={{ background: 'transparent', border: '1px solid var(--adm-border-strong)', color: 'var(--adm-muted)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '8px 16px', cursor: 'pointer' }}>Back to List</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <label style={lbl}>Coupon Code *</label>
          <input style={{ ...inp }} value={form.code} onChange={e => setF('code', e.target.value)} placeholder="e.g. FESTIVE20" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} />
        </div>

        <div className="admin-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label style={lbl}>Discount Type</label>
            <select style={{ ...inp, cursor: 'pointer' }} value={form.type} onChange={e => setF('type', e.target.value)}>
              <option value="percent" style={{ background: '#fff' }}>Percentage Off</option>
              <option value="flat" style={{ background: '#fff' }}>Flat Amount Off</option>
            </select>
          </div>
          <div>
            <label style={lbl}>{form.type === 'percent' ? 'Percentage (%)' : 'Amount (₹)'}</label>
            <input style={inp} type="number" min="0" value={form.value} onChange={e => setF('value', e.target.value)} onWheel={e => e.currentTarget.blur()} placeholder={form.type === 'percent' ? 'e.g. 20' : 'e.g. 500'} onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} />
          </div>
        </div>

        <div>
          <label style={lbl}>Applies To</label>
          <select style={{ ...inp, cursor: 'pointer' }} value={form.applies_to} onChange={e => setF('applies_to', e.target.value)}>
            <option value="all" style={{ background: '#fff' }}>All products — works on any order</option>
            <option value="products" style={{ background: '#fff' }}>Specific product(s) — order must contain at least one</option>
            <option value="bundle" style={{ background: '#fff' }}>Bundle — order must contain ALL selected products</option>
          </select>
        </div>

        {form.applies_to !== 'all' && (
          <div>
            <label style={lbl}>Select Product(s)</label>
            <div style={{ ...helpText, marginBottom: 10 }}>
              {form.applies_to === 'bundle'
                ? 'The coupon only applies when every product checked below is in the cart together.'
                : 'The coupon applies when any one of the products checked below is in the cart.'}
            </div>
            <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--adm-border)', padding: '4px 4px' }}>
              {products.map(p => (
                <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid var(--adm-border)' }}>
                  <input type="checkbox" checked={form.product_ids.includes(p.id)} onChange={() => toggleProduct(p.id)} style={{ accentColor: 'var(--gd)', width: 15, height: 15, cursor: 'pointer' }} />
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--iv)' }}>{p.name}</span>
                </label>
              ))}
              {productsLoading && products.length === 0 && <div style={{ ...helpText, padding: 10 }}>Loading products...</div>}
              {!productsLoading && products.length === 0 && <div style={{ ...helpText, padding: 10 }}>No products yet.</div>}
            </div>
          </div>
        )}

        <div>
          <label style={lbl}>Max Uses (optional)</label>
          <input style={{ ...inp, maxWidth: 200 }} type="number" min="1" value={form.max_uses} onChange={e => setF('max_uses', e.target.value)} onWheel={e => e.currentTarget.blur()} placeholder="Unlimited" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} />
          <div style={{ ...helpText, marginTop: 6 }}>Leave blank for unlimited uses. {editId && form.max_uses ? `Used ${form.times_used || 0} of ${form.max_uses} so far.` : ''}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" checked={form.active} onChange={e => setF('active', e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--gd)', cursor: 'pointer' }} />
          <label style={{ fontFamily: 'var(--font-body)', fontSize: 16, color: 'var(--iv)' }}>Active (customers can use this code)</label>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button onClick={saveCoupon} disabled={saving} style={{ background: 'var(--gd)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '13px 28px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving...' : editId ? 'Update Coupon' : 'Create Coupon'}
          </button>
          {editId && <button onClick={() => { setForm({ ...EMPTY_COUPON }); setEditId(null); setView('list'); }} style={{ background: 'transparent', border: '1px solid var(--adm-border-strong)', color: 'var(--adm-muted)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '13px 28px', cursor: 'pointer' }}>Cancel</button>}
        </div>
      </div>
    </div>
  );
}

// ── GIFT CARDS ─────────────────────────────────────────────
function GiftCardsManager() {
  const { brand, updateBrand, loading: brandLoading } = useBrand();
  const [issued, setIssued] = React.useState([]);
  const [loadingIssued, setLoadingIssued] = React.useState(true);
  const [giftCardSearch, setGiftCardSearch] = React.useState('');
  const [form, setForm] = React.useState({
    giftcard_min: brand.giftcard_min ?? DEFAULT_GIFTCARD_MIN,
    giftcard_max: brand.giftcard_max ?? '', // blank = no upper limit
    giftcard_description: brand.giftcard_description || '',
  });
  const [saving, setSaving] = React.useState(false);

  // BrandContext starts with hardcoded placeholder values and fetches the real
  // saved settings asynchronously -- if this tab is opened before that fetch
  // resolves, the useState above seeds this form from the placeholders, which
  // never resynced once the real brand data arrived. Clicking "Save Settings" at
  // that point silently overwrote real saved values with the placeholders.
  // Resyncs once, the moment BrandContext finishes loading; never again after,
  // so it can't clobber an in-progress edit.
  const brandSyncedRef = React.useRef(!brandLoading);
  React.useEffect(() => {
    if (brandSyncedRef.current || brandLoading) return;
    brandSyncedRef.current = true;
    setForm({
      giftcard_min: brand.giftcard_min ?? DEFAULT_GIFTCARD_MIN,
      giftcard_max: brand.giftcard_max ?? '',
      giftcard_description: brand.giftcard_description || '',
    });
  }, [brandLoading, brand]);

  const navigate = useNavigate();
  React.useEffect(() => {
    safeQuery(supabase.from('gift_cards').select('*').order('created_at', { ascending: false })).then(({ data, error, timedOut }) => {
      if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
      if (timedOut) toast.error('Timed out loading gift cards -- check your connection and try again.');
      else if (error) toast.error('Failed to load gift cards: ' + error.message);
      setIssued(data || []);
      setLoadingIssued(false);
    });
  }, [navigate]);

  async function toggleEnabled() {
    try {
      await updateBrand({ giftcard_enabled: brand.giftcard_enabled === false });
      toast.success(brand.giftcard_enabled === false ? 'Gift cards enabled.' : 'Gift cards disabled.');
    } catch (e) { toast.error('Failed: ' + e.message); }
  }

  async function saveSettings() {
    const min = Number(form.giftcard_min);
    if (!Number.isFinite(min) || min <= 0) { toast.error('Minimum amount must be a positive number.'); return; }
    // Blank max = no upper limit. Only validated as a number when the admin actually sets one.
    let max = null;
    if (form.giftcard_max !== '') {
      max = Number(form.giftcard_max);
      if (!Number.isFinite(max) || max <= min) { toast.error('Maximum amount must be greater than the minimum, or left blank for no limit.'); return; }
    }
    setSaving(true);
    try {
      await updateBrand({
        giftcard_min: min,
        giftcard_max: max,
        giftcard_description: form.giftcard_description,
      });
      toast.success('Gift card settings saved.');
    } catch (e) { toast.error('Failed: ' + e.message); }
    finally { setSaving(false); }
  }

  const lbl = { fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--adm-muted)',  display: 'block', marginBottom: 7 };
  const inp = { width: '100%', padding: '10px 12px', background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontSize: 14.5, outline: 'none', caretColor: 'var(--gd)' };
  const helpText = { fontFamily: 'var(--font-body)', fontSize: 14.5, fontStyle: 'normal', color: 'var(--adm-muted)' };
  const section = { background: '#fff', border: '1px solid var(--adm-border)', borderRadius: 14, boxShadow: '0 1px 2px rgba(21,24,38,.04)', padding: '24px 24px', display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 24 };
  const secHead = { fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--adm-body)', marginBottom: 4 };

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  color: 'var(--gd)', marginBottom: 24 }}>Gift Cards</div>

      <div style={section}>
        <div style={secHead}>Settings</div>
        <div style={helpText}>Customers pick their own amount at /gift-card and buy it like a product. Each purchase creates a real, spendable balance under a unique code — customers (or you, on their behalf) can apply it at checkout, and the balance is deducted automatically. The image shown on the Gift Card page hero is set in Brand Settings → Per-Page Hero Images, alongside your other page banners.</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="checkbox" id="gce" checked={brand.giftcard_enabled !== false} onChange={toggleEnabled} style={{ accentColor: 'var(--gd)', width: 16, height: 16, cursor: 'pointer' }} />
          <label htmlFor="gce" style={{ ...lbl, marginBottom: 0, cursor: 'pointer' }}>Gift cards page enabled</label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div><label style={lbl}>Minimum Amount (₹)</label><input style={inp} type="number" value={form.giftcard_min} onChange={e => setForm(f => ({ ...f, giftcard_min: e.target.value }))} onWheel={e => e.currentTarget.blur()} onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
          <div><label style={lbl}>Maximum Amount (₹) — optional</label><input style={inp} type="number" placeholder="Leave blank for no limit" value={form.giftcard_max} onChange={e => setForm(f => ({ ...f, giftcard_max: e.target.value }))} onWheel={e => e.currentTarget.blur()} onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
        </div>
        <div><label style={lbl}>Page Description</label><textarea style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} rows={2} value={form.giftcard_description} onChange={e => setForm(f => ({ ...f, giftcard_description: e.target.value }))} onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
        <button onClick={saveSettings} disabled={saving} style={{ background: 'var(--gd)', border: 'none', color: 'var(--text-dark)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '13px 28px', cursor: 'pointer', alignSelf: 'flex-start', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div style={secHead}>Issued Gift Cards ({issued.length})</div>
      {!loadingIssued && issued.length > 0 && (
        <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--adm-muted)', marginBottom: 14 }}>
          {fmt(issued.reduce((sum, g) => sum + (Number(g.balance) || 0), 0))} outstanding · {fmt(issued.reduce((sum, g) => sum + ((Number(g.initial_value) || 0) - (Number(g.balance) || 0)), 0))} redeemed to date
        </div>
      )}
      {!loadingIssued && issued.length > 0 && (
        <input value={giftCardSearch} onChange={e => setGiftCardSearch(e.target.value)} placeholder="Search code or recipient..." style={{ ...inp, maxWidth: 280, marginBottom: 14 }} onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} />
      )}
      {loadingIssued ? (
        <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner"></span></div>
      ) : issued.length === 0 ? (
        <AdminEmpty icon="gift" title="No gift cards yet" hint="Gift cards will appear here once customers purchase them." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead><tr>{['Code', 'Balance', 'Initial Value', 'Recipient', 'Purchased'].map(h => <th key={h} style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '10px 12px', textAlign: 'left', borderBottom: '1px solid var(--adm-border)', color: 'var(--adm-muted)' }}>{h}</th>)}</tr></thead>
            <tbody>
              {issued.filter(g => {
                if (!giftCardSearch.trim()) return true;
                const q = giftCardSearch.trim().toLowerCase();
                return [g.code, g.recipient_name, g.recipient_email].some(v => (v || '').toLowerCase().includes(q));
              }).map(g => (
                <tr key={g.id}>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: 'var(--iv)', borderBottom: '1px solid var(--adm-border)' }}>{g.code}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 16, color: Number(g.balance) > 0 ? 'var(--success)' : 'var(--adm-muted)', fontWeight: 500, borderBottom: '1px solid var(--adm-border)' }}>{fmt(g.balance)}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--adm-muted)', borderBottom: '1px solid var(--adm-border)' }}>{fmt(g.initial_value)}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 14.5, color: 'var(--adm-muted)', borderBottom: '1px solid var(--adm-border)' }}>{g.recipient_name ? `${g.recipient_name} (${g.recipient_email})` : '—'}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 14.5, color: 'var(--adm-muted)', borderBottom: '1px solid var(--adm-border)' }}>{g.created_at ? fmtDate(g.created_at) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── EMAIL TEST ─────────────────────────────────────────────
// Confirms the deployed Brevo integration and sends one real test email,
// entirely from the admin's own authenticated browser session. The access
// token is read via supabase.auth.getSession() and attached to the request
// programmatically -- never shown, copied, or sent anywhere else. Superseded
// by the full Notification Center in a later phase; safe to remove then.
function EmailTestPanel() {
  const navigate = useNavigate();
  const [diag, setDiag] = React.useState(null);
  const [diagLoading, setDiagLoading] = React.useState(true);
  const [diagError, setDiagError] = React.useState(null);
  const [toEmail, setToEmail] = React.useState('');
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [sendResult, setSendResult] = React.useState(null);

  // Resolved fresh for every call (never cached) -- the whole point is that
  // this always reflects the current, real logged-in session, same fix
  // pattern the rest of Admin uses to avoid a hung/expired-session request.
  async function getAccessToken() {
    const { data, error } = await withTimeout(supabase.auth.getSession(), 8000);
    return (error || !data?.session?.access_token) ? null : data.session.access_token;
  }

  async function checkConfig() {
    setDiagLoading(true); setDiagError(null);
    const token = await getAccessToken();
    if (!token) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
    try {
      const res = await withTimeout(fetch('/api/send-test-email', { method: 'GET', headers: { Authorization: `Bearer ${token}` } }), 15000);
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || 'Failed to check configuration.');
      setDiag(body);
    } catch (e) {
      setDiagError(e.message || 'Failed to check configuration.');
    } finally { setDiagLoading(false); }
  }

  React.useEffect(() => { checkConfig(); }, []);

  function requestSend() {
    const email = toEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error('Enter a valid email address.'); return; }
    setSendResult(null);
    setConfirmOpen(true);
  }

  async function confirmSend() {
    setConfirmOpen(false);
    setSending(true);
    const token = await getAccessToken();
    if (!token) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); setSending(false); return; }
    try {
      const res = await withTimeout(fetch('/api/send-test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ toEmail: toEmail.trim() }),
      }), 15000);
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || 'Failed to send test email.');
      setSendResult({ ok: true, messageId: body.messageId });
      toast.success('Test email sent.');
    } catch (e) {
      setSendResult({ ok: false, error: e.message || 'Failed to send test email.' });
      toast.error(e.message || 'Failed to send test email.');
    } finally { setSending(false); }
  }

  const lbl = { fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--adm-muted)',  display: 'block', marginBottom: 7 };
  const inp = { width: '100%', padding: '10px 12px', background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontSize: 14.5, outline: 'none', caretColor: 'var(--gd)' };
  const helpText = { fontFamily: 'var(--font-body)', fontSize: 14.5, fontStyle: 'normal', color: 'var(--adm-muted)' };
  const section = { background: '#fff', border: '1px solid var(--adm-border)', borderRadius: 14, boxShadow: '0 1px 2px rgba(21,24,38,.04)', padding: '24px 24px', display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 24 };
  const secHead = { fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--adm-body)', marginBottom: 4 };
  const diagRow = { display: 'flex', justifyContent: 'space-between', gap: 12, fontFamily: 'var(--font-body)', fontSize: 15.5, color: 'var(--adm-muted)', borderBottom: '1px solid var(--adm-border)', padding: '6px 0' };
  const btnGhost = { background: 'transparent', border: '1px solid var(--line)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '10px 20px', cursor: 'pointer', alignSelf: 'flex-start' };
  const btnGold = { background: 'var(--gd)', border: 'none', color: 'var(--text-dark)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '13px 28px', cursor: 'pointer', alignSelf: 'flex-start' };

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  color: 'var(--gd)', marginBottom: 6 }}>Email Test</div>
      <div style={{ ...helpText, marginBottom: 24 }}>Confirms the deployed Brevo configuration and lets you send one real test email from your own logged-in session.</div>

      <div style={section}>
        <div style={secHead}>Deployed Configuration</div>
        {diagLoading ? (
          <div style={helpText}>Checking...</div>
        ) : diagError ? (
          <div style={{ ...helpText, color: 'var(--error)' }}>{diagError}</div>
        ) : diag ? (
          <div>
            <div style={diagRow}><span>Supabase project</span><strong>{diag.supabaseProjectRef || '—'}</strong></div>
            <div style={diagRow}><span>Admin email</span><strong>{diag.adminEmail || '—'}</strong></div>
            <div style={diagRow}><span>Sender address</span><strong>{diag.senderEmail || '—'}</strong></div>
            <div style={diagRow}><span>Brevo API key configured</span><strong>{diag.brevoConfigured ? 'Yes' : 'No'}</strong></div>
          </div>
        ) : null}
        <button onClick={checkConfig} disabled={diagLoading} style={{ ...btnGhost, opacity: diagLoading ? 0.6 : 1 }}>Re-check</button>
      </div>

      <div style={section}>
        <div style={secHead}>Send Test Email</div>
        <div><label style={lbl}>Recipient Email</label><input style={inp} type="email" value={toEmail} onChange={e => setToEmail(e.target.value)} placeholder="you@example.com" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
        <button onClick={requestSend} disabled={sending} style={{ ...btnGold, opacity: sending ? 0.6 : 1 }}>{sending ? 'Sending...' : 'Send Test Email'}</button>
        {sendResult && (
          <div style={{ ...helpText, color: sendResult.ok ? 'var(--success)' : 'var(--error)' }}>
            {sendResult.ok ? `Sent -- Brevo message ID: ${sendResult.messageId}` : `Failed: ${sendResult.error}`}
          </div>
        )}
      </div>

      {confirmOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(21,24,38,.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setConfirmOpen(false)}>
          <div role="dialog" aria-modal="true" style={{ background: '#fff', border: '1px solid var(--adm-border)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', padding: '28px 26px', maxWidth: 440, width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 20, color: 'var(--iv)', marginBottom: 10 }}>Send one test email to:</div>
            <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 16, color: 'var(--gd)', marginBottom: 24, wordBreak: 'break-all' }}>{toEmail.trim()}</div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setConfirmOpen(false)} style={{ flex: 1, background: 'transparent', border: '1px solid var(--line)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '12px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={confirmSend} style={{ flex: 1, background: 'var(--gd)', border: 'none', color: 'var(--text-dark)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '12px', cursor: 'pointer' }}>Confirm &amp; Send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── EMAIL TEMPLATES (Notification Center foundation -- Phase E) ──────────
// List/edit CRUD for email_templates, following the exact same pattern as
// StoriesManager/CouponsManager: direct supabase.from() calls relying on
// RLS (admin-only write, the same auth.jwt()->>'email' check every other
// admin-write policy in this project already uses) -- no dedicated API
// endpoint, since nothing here touches a secret. Block editing is a plain
// add/reorder/remove list, not a drag-and-drop visual editor -- that's a
// later phase; this only needs a structured, editable body_blocks shape.
const EMPTY_TEMPLATE = {
  event_type: EMAIL_EVENTS[0].type,
  name: '',
  subject: '',
  preview_text: '',
  sender_name: '',
  sender_email: '',
  body_blocks: [],
  enabled: true,
  is_system: false,
};

function EmailTemplatesManager() {
  const [templates, setTemplates] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [view, setView] = React.useState('list');
  const [form, setForm] = React.useState({ ...EMPTY_TEMPLATE });
  const [editId, setEditId] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [addBlockType, setAddBlockType] = React.useState('');
  const navigate = useNavigate();

  React.useEffect(() => { fetchTemplates(); }, []);

  async function fetchTemplates() {
    setLoading(true);
    const { data, error, timedOut } = await safeQuery(supabase.from('email_templates').select('*').order('updated_at', { ascending: false }));
    if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
    if (timedOut) toast.error('Timed out loading templates -- check your connection and try again.');
    else if (error) toast.error('Failed to load templates: ' + error.message + (error.code === '42P01' ? ' -- run the email_templates SQL migration in Supabase first.' : ''));
    setTemplates(data || []);
    setLoading(false);
  }

  function setF(key, val) { setForm(f => ({ ...f, [key]: val })); }

  function startNew() { setForm({ ...EMPTY_TEMPLATE }); setEditId(null); setView('edit'); }
  // A saved template can have NULL preview_text / sender fields (they're optional), and spreading a row
  // over EMPTY_TEMPLATE lets that null replace the '' default -- which then crashed saveTemplate's
  // .trim() ("Cannot read properties of null (reading 'trim')") before anything was written.
  function startEdit(t) {
    setForm({
      ...EMPTY_TEMPLATE, ...t,
      subject: t.subject ?? '', name: t.name ?? '', preview_text: t.preview_text ?? '',
      sender_name: t.sender_name ?? '', sender_email: t.sender_email ?? '',
      body_blocks: Array.isArray(t.body_blocks) ? t.body_blocks : [],
    });
    setEditId(t.id); setView('edit');
  }

  function addBlock(type) { setForm(f => ({ ...f, body_blocks: [...f.body_blocks, emptyBlock(type)] })); }
  function updateBlock(i, key, val) { setForm(f => ({ ...f, body_blocks: f.body_blocks.map((b, idx) => idx === i ? { ...b, [key]: val } : b) })); }
  function removeBlock(i) { setForm(f => ({ ...f, body_blocks: f.body_blocks.filter((_, idx) => idx !== i) })); }
  function moveBlock(i, dir) {
    setForm(f => {
      const blocks = [...f.body_blocks];
      const j = i + dir;
      if (j < 0 || j >= blocks.length) return f;
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
      return { ...f, body_blocks: blocks };
    });
  }

  // Non-blocking -- flags an unknown {{token}} in subject/preview/block text
  // fields so a typo is caught at save time instead of silently rendering
  // literally later. Never prevents saving.
  function warnUnknownTokens() {
    // SUPPORT_REPLY is enquiry-shaped, not order-shaped -- validate against
    // whichever variable set actually applies to the selected event.
    const validKeys = variablesForEvent(form.event_type).map(v => v.key);
    const texts = [form.subject, form.preview_text, ...form.body_blocks.flatMap(b => [b.text, b.label].filter(Boolean))];
    const found = new Set();
    for (const t of texts) {
      for (const m of String(t || '').matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) {
        if (!validKeys.includes(m[1])) found.add(m[1]);
      }
    }
    if (found.size > 0) toast(`Unrecognized variable${found.size > 1 ? 's' : ''}: ${[...found].map(k => `{{${k}}}`).join(', ')}`, { icon: <AdminIcon name="warning" size={16} color="#B8791E" /> });
  }

  async function saveTemplate() {
    if (!(form.name || '').trim()) { toast.error('Template name is required.'); return; }
    if (!(form.subject || '').trim()) { toast.error('Subject is required.'); return; }
    if (!EMAIL_EVENT_TYPES.includes(form.event_type)) { toast.error('Choose a valid event.'); return; }
    if (form.sender_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(form.sender_email).trim())) { toast.error('Sender email looks invalid.'); return; }

    setSaving(true);
    try {
      const payload = {
        event_type: form.event_type,
        name: (form.name || '').trim(),
        subject: (form.subject || '').trim(),
        preview_text: (form.preview_text || '').trim(),
        sender_name: (form.sender_name || '').trim() || null,
        sender_email: (form.sender_email || '').trim() || null,
        body_blocks: form.body_blocks,
        enabled: !!form.enabled,
        is_system: !!form.is_system,
        updated_at: new Date().toISOString(),
      };
      // .select('id') so a database that silently refuses the write (a row-level-security policy
      // that filters the row out reports SUCCESS with zero rows changed) is caught here instead of
      // showing "Template updated" for something that never saved.
      const { data: written, error, timedOut } = editId
        ? await safeQuery(supabase.from('email_templates').update(payload).eq('id', editId).select('id'))
        : await safeQuery(supabase.from('email_templates').insert(payload).select('id'));
      if (timedOut) throw new Error('Timed out -- check your connection and try again.');
      if (error) {
        // The partial unique index only allows one is_system row per event --
        // surface that specific case clearly instead of a raw DB error.
        if (error.code === '23505') throw new Error('Another template is already set as the system template for this event. Disable "System template" on that one first.');
        throw error;
      }
      if (!Array.isArray(written) || written.length === 0) {
        throw new Error('NOT SAVED -- the database accepted the request but changed nothing. Sign out and back in as the admin and try again; if it still happens, the email_templates write policy in Supabase does not match your admin login.');
      }
      warnUnknownTokens();
      toast.success(editId ? 'Template updated.' : 'Template created.');
      await fetchTemplates();
      setView('list');
    } catch (e) { toast.error(e.message || 'Failed to save template.'); }
    finally { setSaving(false); }
  }

  async function duplicateTemplate(t) {
    const { id, created_at, updated_at, ...rest } = t;
    const payload = { ...rest, name: `${t.name} (Copy)`, is_system: false, enabled: false };
    const { error, timedOut } = await safeQuery(supabase.from('email_templates').insert(payload));
    if (timedOut) { toast.error('Timed out -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed to duplicate: ' + error.message); return; }
    toast.success('Template duplicated.');
    fetchTemplates();
  }

  async function toggleEnabled(t) {
    const { data: written, error, timedOut } = await safeQuery(supabase.from('email_templates').update({ enabled: !t.enabled, updated_at: new Date().toISOString() }).eq('id', t.id).select('id'));
    if (timedOut) { toast.error('Timed out -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed: ' + error.message); return; }
    if (!Array.isArray(written) || written.length === 0) { toast.error('NOT SAVED -- the database changed nothing. Sign out and back in as the admin and try again.'); return; }
    toast.success(t.enabled ? 'Template disabled.' : 'Template enabled.');
    fetchTemplates();
  }

  async function deleteTemplate(t) {
    if (t.is_system) { toast.error('System templates can\'t be deleted from here -- disable "System template" on it first.'); return; }
    if (!window.confirm(`Delete "${t.name}" permanently?`)) return;
    const { error, timedOut } = await safeQuery(supabase.from('email_templates').delete().eq('id', t.id));
    if (timedOut) { toast.error('Timed out -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed to delete: ' + error.message); return; }
    toast.success('Template deleted.');
    fetchTemplates();
  }

  const lbl = { fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--adm-muted)',  display: 'block', marginBottom: 7 };
  const inp = { width: '100%', padding: '10px 12px', background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontSize: 14.5, outline: 'none', caretColor: 'var(--gd)' };
  const helpText = { fontFamily: 'var(--font-body)', fontSize: 14.5, fontStyle: 'normal', color: 'var(--adm-muted)' };
  const section = { background: '#fff', border: '1px solid var(--adm-border)', borderRadius: 14, boxShadow: '0 1px 2px rgba(21,24,38,.04)', padding: '24px 24px', display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 24 };
  const secHead = { fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--adm-body)', marginBottom: 4 };
  const btnGold = { background: 'var(--gd)', border: 'none', color: 'var(--text-dark)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '13px 28px', cursor: 'pointer', alignSelf: 'flex-start' };
  const btnGhost = { background: 'transparent', border: '1px solid var(--line)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11.5,  padding: '7px 12px', cursor: 'pointer' };

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner"></span></div>;

  if (view === 'edit') {
    return (
      <div style={{ maxWidth: 980 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  color: 'var(--gd)', marginBottom: 24 }}>
          {editId ? 'Edit Template' : 'New Template'}
        </div>

        <div style={section}>
          <div style={secHead}>Details</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><label style={lbl}>Template Name</label><input style={inp} value={form.name} onChange={e => setF('name', e.target.value)} /></div>
            <div>
              <label style={lbl}>Event</label>
              <select style={inp} value={form.event_type} onChange={e => setF('event_type', e.target.value)}>
                {EMAIL_EVENTS.map(ev => <option key={ev.type} value={ev.type}>{ev.label}</option>)}
              </select>
            </div>
          </div>
          <div style={helpText}>{EMAIL_EVENTS.find(ev => ev.type === form.event_type)?.description}</div>
          <div><label style={lbl}>Subject</label><input style={inp} value={form.subject} onChange={e => setF('subject', e.target.value)} placeholder="e.g. Your Brightlight Solutions order {{order_number}} is confirmed" /></div>
          <div><label style={lbl}>Preview Text</label><input style={inp} value={form.preview_text} onChange={e => setF('preview_text', e.target.value)} placeholder="Shown as inbox preview text in most email clients" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><label style={lbl}>Sender Name -- optional</label><input style={inp} value={form.sender_name} onChange={e => setF('sender_name', e.target.value)} placeholder="Brightlight Solutions" /></div>
            <div><label style={lbl}>Sender Email -- optional</label><input style={inp} value={form.sender_email} onChange={e => setF('sender_email', e.target.value)} placeholder="Defaults to orders@ or contact@ by event" /></div>
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" id="et-enabled" checked={form.enabled} onChange={e => setF('enabled', e.target.checked)} style={{ accentColor: 'var(--gd)', width: 16, height: 16, cursor: 'pointer' }} />
              <label htmlFor="et-enabled" style={{ ...lbl, marginBottom: 0, cursor: 'pointer' }}>Enabled</label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" id="et-system" checked={form.is_system} onChange={e => setF('is_system', e.target.checked)} style={{ accentColor: 'var(--gd)', width: 16, height: 16, cursor: 'pointer' }} />
              <label htmlFor="et-system" style={{ ...lbl, marginBottom: 0, cursor: 'pointer' }}>System template for this event</label>
            </div>
          </div>
          <div style={helpText}>Only one template can be the system template per event. For Order Confirmed, that's the one sent automatically right after payment is verified; other events currently send manually from Orders &gt; Set &amp; Notify. Everything else here is a draft/duplicate for editing or testing.</div>
        </div>

        <div style={section}>
          <div style={secHead}>Content Blocks</div>
          <div style={helpText}>Available variables: {(form.event_type === 'SUPPORT_REPLY' ? SUPPORT_VARIABLE_KEYS : EMAIL_VARIABLE_KEYS).map(k => `{{${k}}}`).join(', ')}</div>
          {form.body_blocks.length === 0 && <div style={helpText}>No blocks yet -- add one below.</div>}
          {form.body_blocks.map((block, i) => {
            const def = BLOCK_TYPES.find(b => b.type === block.type);
            return (
              <div key={i} style={{ border: '1px solid var(--adm-border)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 12,  color: 'var(--iv)' }}>{def?.label || block.type}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={() => moveBlock(i, -1)} disabled={i === 0} style={{ ...btnGhost, opacity: i === 0 ? 0.4 : 1 }}>Up</button>
                    <button type="button" onClick={() => moveBlock(i, 1)} disabled={i === form.body_blocks.length - 1} style={{ ...btnGhost, opacity: i === form.body_blocks.length - 1 ? 0.4 : 1 }}>Down</button>
                    <button type="button" onClick={() => removeBlock(i)} style={{ ...btnGhost, color: 'var(--error)', borderColor: 'var(--error)55' }}>Remove</button>
                  </div>
                </div>
                {(def?.fields || []).map(f => (
                  f === 'text'
                    ? <textarea key={f} style={{ ...inp, resize: 'vertical' }} rows={2} placeholder={f} value={block[f] || ''} onChange={e => updateBlock(i, f, e.target.value)} />
                    : <input key={f} style={inp} placeholder={f} value={block[f] || ''} onChange={e => updateBlock(i, f, e.target.value)} />
                ))}
                {(def?.fields || []).length === 0 && <div style={helpText}>Rendered automatically from order data -- no content to enter.</div>}
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select style={{ ...inp, width: 'auto', flex: 1 }} value={addBlockType} onChange={e => setAddBlockType(e.target.value)}>
              <option value="">Add a block...</option>
              {BLOCK_TYPES.map(b => <option key={b.type} value={b.type}>{b.label}</option>)}
            </select>
            <button type="button" style={btnGhost} onClick={() => { if (addBlockType) { addBlock(addBlockType); setAddBlockType(''); } }}>Add</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={saveTemplate} disabled={saving} style={{ ...btnGold, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving...' : 'Save Template'}</button>
          <button onClick={() => setView('list')} style={btnGhost}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  color: 'var(--gd)' }}>Email Templates</div>
        <button onClick={startNew} style={btnGold}>New Template</button>
      </div>
      <div style={{ ...helpText, marginBottom: 20 }}>Order Confirmed sends automatically once payment is verified (the enabled System template for that event). Every other event here sends manually, from Orders &gt; Set &amp; Notify -- or use this screen to edit and test a template first.</div>
      {templates.length === 0 ? (
        <AdminEmpty icon="mail" title="No templates yet" hint="Click &quot;New Template&quot; to create one." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead><tr>{['Name', 'Event', 'Subject', 'Sender', 'Enabled', 'Last Updated', 'Actions'].map(h => <th key={h} style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '10px 12px', textAlign: 'left', borderBottom: '1px solid var(--adm-border)', color: 'var(--adm-muted)' }}>{h}</th>)}</tr></thead>
            <tbody>
              {templates.map(t => (
                <tr key={t.id}>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: 'var(--iv)', borderBottom: '1px solid var(--adm-border)' }}>
                    {t.name}
                    {t.is_system && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700,  color: 'var(--gd)', border: '1px solid var(--gd)', borderRadius: 2, padding: '1px 5px' }}>SYSTEM</span>}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 14.5, color: 'var(--adm-muted)', borderBottom: '1px solid var(--adm-border)' }}>{emailEventLabel(t.event_type)}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 14.5, color: 'var(--adm-muted)', borderBottom: '1px solid var(--adm-border)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--adm-muted)', borderBottom: '1px solid var(--adm-border)' }}>{t.sender_email || 'Default'}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--adm-border)' }}><span className={`adm-badge ${t.enabled ? 'success' : 'neutral'}`}>{t.enabled ? 'Enabled' : 'Disabled'}</span></td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--adm-muted)', borderBottom: '1px solid var(--adm-border)' }}>{t.updated_at ? fmtDate(t.updated_at) : '-'}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--adm-border)' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => startEdit(t)} style={btnGhost}>Edit</button>
                      <button onClick={() => duplicateTemplate(t)} style={btnGhost}>Duplicate</button>
                      <button onClick={() => toggleEnabled(t)} style={btnGhost}>{t.enabled ? 'Disable' : 'Enable'}</button>
                      {!t.is_system && <button onClick={() => deleteTemplate(t)} style={{ ...btnGhost, color: 'var(--error)', borderColor: 'var(--error)55' }}>Delete</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── WHATSAPP TEMPLATES ─────────────────────────────────────
// Plain-text counterpart to EmailTemplatesManager above -- WhatsApp messages
// have no rich content blocks, so this is one card per fixed event (see
// whatsappEvents.js) with a name, a message textarea, and an enabled toggle,
// rather than a list/edit-view CRUD flow. `event_type` is UNIQUE on
// whatsapp_templates, so saving is always an upsert keyed on it.
function WhatsAppTemplatesManager() {
  const [templates, setTemplates] = React.useState({});
  const [loading, setLoading] = React.useState(true);
  const [savingType, setSavingType] = React.useState(null);
  const navigate = useNavigate();

  React.useEffect(() => { fetchTemplates(); }, []);

  async function fetchTemplates() {
    setLoading(true);
    const { data, error, timedOut } = await safeQuery(supabase.from('whatsapp_templates').select('*'));
    if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
    if (timedOut) toast.error('Timed out loading templates -- check your connection and try again.');
    else if (error) toast.error('Failed to load templates: ' + error.message + (error.code === '42P01' ? ' -- run the whatsapp_templates SQL migration in Supabase first.' : ''));
    const byType = {};
    for (const t of (data || [])) byType[t.event_type] = t;
    setTemplates(byType);
    setLoading(false);
  }

  function setField(eventType, key, val) {
    setTemplates(prev => ({
      ...prev,
      [eventType]: { ...(prev[eventType] || { event_type: eventType, name: eventType, message: '', enabled: true }), [key]: val },
    }));
  }

  async function save(eventType) {
    const t = templates[eventType] || { event_type: eventType, name: eventType, message: '', enabled: true };
    if (!t.message.trim()) { toast.error('Message is required.'); return; }
    setSavingType(eventType);
    const payload = { event_type: eventType, name: t.name || eventType, message: t.message, enabled: t.enabled !== false, updated_at: new Date().toISOString() };
    const { data, error, timedOut } = await safeQuery(supabase.from('whatsapp_templates').upsert(payload, { onConflict: 'event_type' }).select().maybeSingle());
    setSavingType(null);
    if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
    if (timedOut) { toast.error('Timed out -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed to save: ' + error.message); return; }
    setTemplates(prev => ({ ...prev, [eventType]: data }));
    toast.success('Saved.');
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><span className="spinner"></span></div>;

  const lbl = { fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--adm-muted)',  display: 'block', marginBottom: 7 };
  const inp = { width: '100%', padding: '10px 12px', background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontSize: 14.5, outline: 'none' };

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  color: 'var(--gd)', marginBottom: 8 }}>WhatsApp Templates</div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 15.5, fontStyle: 'normal', color: 'var(--adm-muted)', marginBottom: 24 }}>
        Order Confirmed sends automatically right after a Razorpay payment is verified. Order Shipped and Order Delivered send manually, from Orders &gt; Set &amp; Notify. Available variables: {WHATSAPP_VARIABLE_KEYS.map(k => `{{${k}}}`).join(', ')}.
      </div>
      {WHATSAPP_EVENTS.map(evt => {
        const t = templates[evt.type] || { name: evt.type, message: '', enabled: true };
        return (
          <div key={evt.type} style={{ background: '#FFFFFF', border: '1px solid var(--adm-border)', borderRadius: 8, padding: '20px 22px', marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4, gap: 12 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 20, color: 'var(--iv)', fontWeight: 500 }}>{evt.label}</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontStyle: 'normal', color: 'var(--adm-muted)' }}>{evt.description}</div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flexShrink: 0 }}>
                <input type="checkbox" checked={t.enabled !== false} onChange={e => setField(evt.type, 'enabled', e.target.checked)} style={{ accentColor: 'var(--gd)', width: 16, height: 16, cursor: 'pointer' }} />
                <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  color: 'var(--adm-muted)' }}>Enabled</span>
              </label>
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={lbl}>Template Name</label>
              <input style={inp} value={t.name ?? evt.type} onChange={e => setField(evt.type, 'name', e.target.value)} />
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={lbl}>Message</label>
              <textarea style={{ ...inp, resize: 'vertical', lineHeight: 1.6, fontFamily: 'monospace', fontSize: 13.5 }} rows={8} value={t.message} onChange={e => setField(evt.type, 'message', e.target.value)} />
            </div>
            <button onClick={() => save(evt.type)} disabled={savingType === evt.type} style={{ marginTop: 14, background: 'var(--gd)', border: 'none', color: 'var(--text-dark)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  padding: '10px 22px', cursor: 'pointer', opacity: savingType === evt.type ? 0.6 : 1 }}>
              {savingType === evt.type ? 'Saving...' : 'Save'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── PRODUCT NOTIFICATIONS (back-in-stock subscriptions) ───
// Read-only admin view over product_notifications (see
// src/components/NotifyWhenAvailable.jsx, the only place rows are created).
// Internal reference only -- never exposed publicly. Filters are client-side
// over the already-fetched list, matching how Admin's other simple list tabs
// (e.g. Enquiries) already filter, rather than adding new server-side query
// plumbing for what's expected to be a modest row count.
function ProductNotificationsManager() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => { fetchNotifications(); }, []);

  async function fetchNotifications() {
    setLoading(true);
    const { data, error, timedOut } = await safeQuery(supabase.from('product_notifications').select('*').order('created_at', { ascending: false }));
    if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
    if (timedOut) toast.error('Timed out loading notifications -- check your connection and try again.');
    else if (error) toast.error('Failed to load notifications: ' + error.message + (error.code === '42P01' ? ' -- run the product_notifications SQL migration in Supabase first.' : ''));
    setItems(data || []);
    setLoading(false);
  }

  async function markNotified(n) {
    const { error, timedOut } = await safeQuery(supabase.from('product_notifications').update({ status: 'notified', notified_at: new Date().toISOString() }).eq('id', n.id));
    if (timedOut) { toast.error('Timed out -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed: ' + error.message); return; }
    toast.success('Marked as notified.');
    fetchNotifications();
  }

  const filtered = items.filter(n => {
    if (statusFilter !== 'all' && n.status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [n.product_name, n.user_name, n.user_email, n.user_phone].some(v => (v || '').toLowerCase().includes(q));
  });

  const lbl = { fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--adm-muted)',  display: 'block', marginBottom: 7 };
  const inp = { padding: '10px 12px', background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontSize: 14.5, outline: 'none' };

  return (
    <div>
      <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  color: 'var(--gd)', marginBottom: 20 }}>Product Notifications</div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <label style={lbl}>Search</label>
          <input style={{ ...inp, width: 240 }} placeholder="Product, name, email, phone" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div>
          <label style={lbl}>Status</label>
          <select style={inp} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="waiting">Waiting for Stock</option>
            <option value="notified">Notified</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner"></span></div>
      ) : filtered.length === 0 ? (
        <AdminEmpty icon="bell" title={items.length ? 'No requests match your filters' : 'No stock alerts yet'} hint={items.length ? 'Try clearing a filter.' : 'When customers ask to be notified about a sold-out product, they will appear here.'} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead><tr>{['Customer', 'Product', 'Size', 'Requested', 'Status', 'Actions'].map(h => <th key={h} style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '10px 12px', textAlign: 'left', borderBottom: '1px solid var(--adm-border)', color: 'var(--adm-muted)' }}>{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map(n => (
                <tr key={n.id}>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 14.5, color: 'var(--adm-muted)', borderBottom: '1px solid var(--adm-border)' }}>{n.user_name || '-'}<br /><span style={{ opacity: 0.6, fontSize: 13 }}>{n.user_email}{n.user_phone ? ` · ${n.user_phone}` : ''}</span></td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, color: 'var(--iv)', borderBottom: '1px solid var(--adm-border)' }}>{n.product_name}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 14.5, color: 'var(--adm-muted)', borderBottom: '1px solid var(--adm-border)' }}>{n.size || '-'}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--adm-muted)', borderBottom: '1px solid var(--adm-border)' }}>{n.created_at ? fmtDate(n.created_at) : '-'}</td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--adm-border)' }}><span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 11,  color: n.status === 'notified' ? 'var(--success)' : 'var(--gd)' }}>{n.status === 'notified' ? 'Notified' : 'Waiting'}</span></td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--adm-border)' }}>
                    {n.status !== 'notified' && <button onClick={() => markNotified(n)} style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11.5,  padding: '7px 12px', cursor: 'pointer' }}>Mark Notified</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── BRAND SETTINGS ────────────────────────────────────────
function BrandSettings() {
  const { brand, updateBrand } = useBrand();
  const [form, setForm] = React.useState({
    brand_name: brand.brand_name || '', tagline: brand.tagline || '', registered_office: brand.registered_office || '',
    about_video_caption: brand.about_video_caption || '',
    home_featured_label: brand.home_featured_label || '', home_featured_title: brand.home_featured_title || '',
    home_ink_eyebrow: brand.home_ink_eyebrow || '',
    home_ink_title: brand.home_ink_title || '', home_ink_body: brand.home_ink_body || '', home_ig_followers: brand.home_ig_followers || '',
    home_tagline_heading: brand.home_tagline_heading || '',
    delivery_metro_cities: brand.delivery_metro_cities || '', delivery_extra_days: brand.delivery_extra_days ?? 3,
  });
  const [savingHome, setSavingHome] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [savingDelivery, setSavingDelivery] = React.useState(false);
  const [logoUrl, setLogoUrl] = React.useState('');

  // Per-page hero image URL inputs -- Home's own hero is managed entirely via
  // the Hero Slides tab now (hero_slides table), not one of these fields.
  const [heroUrls, setHeroUrls] = React.useState({
    hero_shop: '', hero_about: '', hero_services: '', hero_stories: '', hero_care: '', hero_giftcard: '', about_image: '', splash_logo: '', order_confirmation_hero_image: '',
    hero_shop_mobile_image: '', hero_stories_mobile_image: '',
    hero_about_mobile_image: '', hero_services_mobile_image: '', hero_care_mobile_image: '', hero_giftcard_mobile_image: '',
  });

  // Social links -- shown in the email footer only when actually set.
  const [social, setSocial] = React.useState({
    instagram_url: brand.instagram_url || '', facebook_url: brand.facebook_url || '',
    youtube_url: brand.youtube_url || '', pinterest_url: brand.pinterest_url || '',
  });
  const [savingSocial, setSavingSocial] = React.useState(false);
  async function saveSocial() {
    // SEC-XSS-3: these render as real <a href> links in the site footer and
    // the order-confirmation email -- reject anything safeHref() wouldn't
    // allow there instead of saving it.
    for (const [key, label] of [['instagram_url', 'Instagram'], ['facebook_url', 'Facebook'], ['youtube_url', 'YouTube'], ['pinterest_url', 'Pinterest']]) {
      const v = (social[key] || '').trim();
      if (v && !safeHref(v)) { toast.error(`${label} URL looks unsafe or invalid.`); return; }
    }
    setSavingSocial(true);
    try { await updateBrand(social); toast.success('Social links saved.'); }
    catch (e) { toast.error('Failed: ' + e.message); }
    finally { setSavingSocial(false); }
  }

  // Category taxonomy (masters/groups shown in the navbar mega-menu + Shop filter)
  const [taxonomy, setTaxonomy] = React.useState(() => effectiveTaxonomy(brand));
  const [newGroupName, setNewGroupName] = React.useState('');
  const [newItemInputs, setNewItemInputs] = React.useState({});
  const [savingTaxonomy, setSavingTaxonomy] = React.useState(false);
  const [comingSoon, setComingSoon] = React.useState(() => (Array.isArray(brand.coming_soon_categories) ? brand.coming_soon_categories : COMING_SOON_CATEGORIES));

  // Help guides (shown on the Help page)
  const [careGuides, setCareGuides] = React.useState(() => (brand.care_guides?.length ? brand.care_guides : CARE_GUIDES_DEFAULT));
  const [savingCareGuides, setSavingCareGuides] = React.useState(false);
  function updateGuide(i, key, val) { setCareGuides(gs => gs.map((g, idx) => idx === i ? { ...g, [key]: val } : g)); }
  function updateGuideSteps(i, stepsText) {
    setCareGuides(gs => gs.map((g, idx) => idx === i ? { ...g, steps: stepsText.split('\n').map(s => s.trim()).filter(Boolean) } : g));
  }
  function addGuide() { setCareGuides(gs => [...gs, { material: '', icon: '◈', tagline: '', steps: [], note: '' }]); }
  function removeGuide(i) { setCareGuides(gs => gs.filter((_, idx) => idx !== i)); }
  function moveGuide(i, dir) {
    setCareGuides(gs => {
      const arr = [...gs];
      const target = i + dir;
      if (target < 0 || target >= arr.length) return arr;
      [arr[i], arr[target]] = [arr[target], arr[i]];
      return arr;
    });
  }
  async function saveCareGuides() {
    setSavingCareGuides(true);
    try { await updateBrand({ care_guides: careGuides }); toast.success('Help guides saved.'); }
    catch { toast.error('Failed to save. Run the care_guides SQL migration in Supabase if this keeps failing.'); }
    finally { setSavingCareGuides(false); }
  }

  const [settingsTab, setSettingsTab] = React.useState(0);

  const lbl = { fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--adm-muted)',  display: 'block', marginBottom: 7 };
  const inp = { width: '100%', padding: '10px 12px', background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontSize: 14.5, outline: 'none', caretColor: 'var(--gd)' };
  const section = { background: '#fff', border: '1px solid var(--adm-border)', borderRadius: 14, boxShadow: '0 1px 2px rgba(21,24,38,.04)', padding: '24px 24px', display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 16 };
  const secHead = { fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--adm-body)', marginBottom: 4 };
  const helpText = { fontFamily: 'var(--font-body)', fontSize: 14.5, fontStyle: 'normal', color: 'var(--adm-muted)' };

  async function saveLogoUrl(url) {
    const v = (url ?? logoUrl).trim();
    if (!v) return;
    try { await updateBrand({ logo_url: v }); toast.success('Logo saved.'); setLogoUrl(''); }
    catch (e) { toast.error('Failed: ' + e.message); }
  }

  async function saveHeroField(field, url) {
    const val = (url ?? heroUrls[field])?.trim();
    if (!val) return;
    try {
      await updateBrand({ [field]: val });
      toast.success('Image saved.');
      setHeroUrls(h => ({ ...h, [field]: '' }));
    } catch { toast.error('Failed to save. Run the hero_image SQL migration in Supabase if this keeps failing.'); }
  }

  async function removeHeroField(field) {
    // UX-52: shared by every "Remove Image"/"Remove"/"Remove Video" button on
    // this tab (per-page heroes, splash logo, about image, order-confirmation
    // hero, about video) -- one confirm here covers all of them.
    if (!window.confirm('Remove this image? It will stop showing on the live site.')) return;
    try { await updateBrand({ [field]: '' }); toast.success('Image removed.'); }
    catch (e) { toast.error('Failed: ' + e.message); }
  }

  async function saveAboutCaption() {
    try { await updateBrand({ about_video_caption: form.about_video_caption }); toast.success('Caption saved.'); }
    catch (e) { toast.error('Failed: ' + e.message); }
  }

  async function savePositionField(field, val) {
    try { await updateBrand({ [`${field}_position`]: val }); toast.success('Crop position saved.'); }
    catch { toast.error('Failed to save. Run the image position SQL migration in Supabase if this keeps failing.'); }
  }

  async function saveBrand() {
    setSaving(true);
    try { await updateBrand({ brand_name: form.brand_name, tagline: form.tagline, registered_office: form.registered_office }); toast.success('Brand settings saved.'); }
    catch (e) { toast.error('Failed: ' + e.message); }
    finally { setSaving(false); }
  }

  async function saveFeaturedCount(n) {
    try { await updateBrand({ featured_count: n }); toast.success('Home page showcase updated.'); }
    catch (e) { toast.error('Failed: ' + e.message); }
  }

  async function saveHomeText() {
    setSavingHome(true);
    try {
      await updateBrand({
        home_featured_label: form.home_featured_label, home_featured_title: form.home_featured_title,
        home_ink_eyebrow: form.home_ink_eyebrow,
        home_ink_title: form.home_ink_title, home_ink_body: form.home_ink_body, home_ig_followers: form.home_ig_followers,
        home_tagline_heading: form.home_tagline_heading,
      });
      toast.success('Home page text saved.');
    } catch { toast.error('Failed. Run the home text SQL migration in Supabase if this keeps failing.'); }
    finally { setSavingHome(false); }
  }

  async function saveDeliverySettings() {
    setSavingDelivery(true);
    try {
      await updateBrand({
        delivery_metro_cities: form.delivery_metro_cities,
        delivery_extra_days: Number(form.delivery_extra_days) || 0,
      });
      toast.success('Delivery settings saved.');
    } catch { toast.error('Failed. Run the delivery SQL migration in Supabase if this keeps failing.'); }
    finally { setSavingDelivery(false); }
  }

  function addGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    if (taxonomy.some(g => g.label.toLowerCase() === name.toLowerCase())) { toast.error('A master with that name already exists.'); return; }
    setTaxonomy(t => [...t, { label: name, items: [] }]);
    setNewGroupName('');
  }
  function removeGroup(label) {
    setTaxonomy(t => t.filter(g => g.label !== label));
  }
  function addItem(groupLabel) {
    const val = (newItemInputs[groupLabel] || '').trim();
    if (!val) return;
    const group = taxonomy.find(g => g.label === groupLabel);
    // Case-insensitive, matching addGroup's own duplicate check above -- this used
    // to be a case-SENSITIVE .includes(), so "Cotton" and "cotton" could exist
    // side by side as two distinct, fragmenting categories with no warning.
    if (group?.items.some(i => i.toLowerCase() === val.toLowerCase())) {
      toast.error('A category with that name already exists in this master.');
      return;
    }
    setTaxonomy(t => t.map(g => g.label === groupLabel ? { ...g, items: [...g.items, val] } : g));
    setNewItemInputs(s => ({ ...s, [groupLabel]: '' }));
  }
  function removeItem(groupLabel, item) {
    setTaxonomy(t => t.map(g => g.label === groupLabel ? { ...g, items: g.items.filter(i => i !== item) } : g));
    setComingSoon(cs => cs.filter(i => i !== item));
  }
  function toggleComingSoon(item) {
    setComingSoon(cs => cs.includes(item) ? cs.filter(i => i !== item) : [...cs, item]);
  }
  async function saveTaxonomy() {
    setSavingTaxonomy(true);
    try { await updateBrand({ category_taxonomy: taxonomy, coming_soon_categories: comingSoon }); toast.success('Category structure saved.'); }
    catch { toast.error('Failed. Run the category_taxonomy SQL migration in Supabase if this keeps failing.'); }
    finally { setSavingTaxonomy(false); }
  }
  function resetTaxonomy() {
    setTaxonomy(CATEGORY_GROUPS);
    // Prune any "Coming Soon" flags left pointing at a category that no longer
    // exists after the reset -- removeItem() already does this for a single
    // deletion, a full reset just skipped it.
    const validItems = new Set(CATEGORY_GROUPS.flatMap(g => g.items));
    setComingSoon(cs => cs.filter(i => validItems.has(i)));
  }

  // HeroImageField / MobileHeroImageField are now module-scope components
  // (see right after ImagePositionPicker) -- were previously declared here,
  // which caused a focus-loss bug: a new closure every render meant React
  // remounted the whole subtree (including the <input>) on every keystroke.
  // The JSX call sites below now pass brand/heroUrls/handlers as props.

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  color: 'var(--gd)', marginBottom: 20 }}>Brand Settings</div>

      {/* SUB-TABS */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid var(--adm-border)' }}>
        {SETTINGS_TABS.map((t, i) => (
          <button key={t} onClick={() => setSettingsTab(i)} style={{
            fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12, 
            padding: '8px 16px', border: `1px solid ${settingsTab === i ? 'var(--gd)' : 'var(--adm-border-strong)'}`,
            background: settingsTab === i ? 'var(--gd)' : 'transparent', color: settingsTab === i ? '#fff' : 'var(--adm-muted)',
            cursor: 'pointer', borderRadius: 3,
          }}>{t}</button>
        ))}
      </div>

      {/* GENERAL */}
      {settingsTab === 0 && (
        <>
          <div style={section}>
            <div style={secHead}>Logo Image</div>
            {brand.logo_url && <img src={thumb(brand.logo_url, 300)} alt="Logo" style={{ height: 48, objectFit: 'contain', maxWidth: 200, marginBottom: 4, display: 'block', border: '1px solid var(--adm-border)', padding: 6 }} />}
            <MediaUrlField value={logoUrl} onChange={setLogoUrl} onSave={saveLogoUrl} placeholder="Paste a logo URL..." inputStyle={inp} saveLabel="Save Logo" />
            {brand.logo_url && <button onClick={async () => {
              // UX-52: this had neither a confirm nor error feedback -- a
              // mis-click silently removed the site's logo.
              if (!window.confirm('Remove the site logo?')) return;
              try { await updateBrand({ logo_url: '' }); toast.success('Logo removed.'); }
              catch (e) { toast.error('Failed: ' + e.message); }
            }} style={{ background: 'none', border: '1px solid rgba(192,53,43,.4)', color: 'var(--error)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5,  padding: '5px 12px', cursor: 'pointer', alignSelf: 'flex-start' }}>Remove Logo</button>}
          </div>

          <div style={section}>
            <div style={secHead}>Loading Screen Logo</div>
            <div style={helpText}>Shown full-screen while the website loads. If empty, the main logo is used.</div>
            {brand.splash_logo && <img src={thumb(brand.splash_logo, 300)} alt="Splash logo" style={{ height: 64, objectFit: 'contain', maxWidth: 200, marginBottom: 4, display: 'block', border: '1px solid var(--adm-border)', padding: 6 }} />}
            <MediaUrlField
              value={heroUrls.splash_logo || ''}
              onChange={v => setHeroUrls(h => ({ ...h, splash_logo: v }))}
              onSave={url => saveHeroField('splash_logo', url)}
              placeholder="Paste a logo URL..."
              inputStyle={inp}
            />
            {brand.splash_logo && <button onClick={() => removeHeroField('splash_logo')} style={{ marginTop: 8, background: 'none', border: '1px solid rgba(192,53,43,.4)', color: 'var(--error)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5,  padding: '5px 12px', cursor: 'pointer', alignSelf: 'flex-start' }}>Remove</button>}
          </div>

          <div style={section}>
            <div style={secHead}>Brand Text</div>
            <div><label style={lbl}>Brand Name</label><input style={inp} value={form.brand_name} onChange={e => setForm(f => ({ ...f, brand_name: e.target.value }))} onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
            <div><label style={lbl}>Tagline</label><input style={inp} value={form.tagline} onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))} onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
            <div><label style={lbl}>Registered Office (shown in the footer)</label><textarea style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} rows={2} value={form.registered_office} onChange={e => setForm(f => ({ ...f, registered_office: e.target.value }))} placeholder="e.g. Kamatchi Amman Kovil Street, Kumarananthapuram, Tiruppur, Tamil Nadu 641602" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
            <button onClick={saveBrand} disabled={saving} style={{ background: 'var(--gd)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '13px 28px', cursor: 'pointer', alignSelf: 'flex-start', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving...' : 'Save Brand Text'}
            </button>
          </div>

          <div style={section}>
            <div style={secHead}>Social Links</div>
            <div style={helpText}>Shown in the order confirmation email's footer. Leave any of these blank to hide it -- only real, filled-in links are ever shown.</div>
            <div><label style={lbl}>Instagram URL</label><input style={inp} value={social.instagram_url} onChange={e => setSocial(s => ({ ...s, instagram_url: e.target.value }))} placeholder="https://instagram.com/your-page" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
            <div><label style={lbl}>Facebook URL</label><input style={inp} value={social.facebook_url} onChange={e => setSocial(s => ({ ...s, facebook_url: e.target.value }))} placeholder="https://facebook.com/your-page" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
            <div><label style={lbl}>YouTube URL</label><input style={inp} value={social.youtube_url} onChange={e => setSocial(s => ({ ...s, youtube_url: e.target.value }))} placeholder="https://youtube.com/@your-channel" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
            <div><label style={lbl}>Pinterest URL</label><input style={inp} value={social.pinterest_url} onChange={e => setSocial(s => ({ ...s, pinterest_url: e.target.value }))} placeholder="https://pinterest.com/your-page" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
            <button onClick={saveSocial} disabled={savingSocial} style={{ background: 'var(--gd)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '13px 28px', cursor: 'pointer', alignSelf: 'flex-start', opacity: savingSocial ? 0.6 : 1 }}>
              {savingSocial ? 'Saving...' : 'Save Social Links'}
            </button>
          </div>
        </>
      )}

      {/* HOME PAGE */}
      {settingsTab === 1 && (
        <>
          <div style={section}>
            <div style={secHead}>Home Page Product Showcase</div>
            <div style={helpText}>Choose how many products appear in the "Featured Products" section on the homepage.</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={brand.featured_count || 3} onChange={e => saveFeaturedCount(Number(e.target.value))} style={{ ...inp, width: 120, cursor: 'pointer' }}>
                {[2,3,4,5,6].map(n => <option key={n} value={n} style={{ background: '#fff' }}>{n} products</option>)}
              </select>
              <span style={helpText}>currently showing {brand.featured_count || 3}</span>
            </div>
          </div>

          <div style={section}>
            <div style={secHead}>Home Page Text</div>
            <div style={helpText}>Edit the wording on the homepage — the featured products label, the tagline below it, the dark highlight band, and your Instagram follower count.</div>
            <div><label style={lbl}>Featured Products — Small Label</label><input style={inp} value={form.home_featured_label} onChange={e => setForm(f => ({ ...f, home_featured_label: e.target.value }))} placeholder="Featured Products" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
            <div><label style={lbl}>Featured Products — Heading</label><input style={inp} value={form.home_featured_title} onChange={e => setForm(f => ({ ...f, home_featured_title: e.target.value }))} placeholder="Top Picks For You" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
            <div><label style={lbl}>Tagline (shown below the Featured Products grid — press Enter for a line break)</label><textarea style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} rows={2} value={form.home_tagline_heading} onChange={e => setForm(f => ({ ...f, home_tagline_heading: e.target.value }))} placeholder={"Shop smart. Shop Brightlight."} onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
            <div><label style={lbl}>Dark Band — Small Label</label><input style={inp} value={form.home_ink_eyebrow} onChange={e => setForm(f => ({ ...f, home_ink_eyebrow: e.target.value }))} placeholder="Why Brightlight" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
            <div><label style={lbl}>Dark Band — Heading</label><input style={inp} value={form.home_ink_title} onChange={e => setForm(f => ({ ...f, home_ink_title: e.target.value }))} placeholder="Everything you need, delivered to your door." onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
            <div><label style={lbl}>Dark Band — Paragraph</label><textarea style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} rows={4} value={form.home_ink_body} onChange={e => setForm(f => ({ ...f, home_ink_body: e.target.value }))} onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
            <div><label style={lbl}>Instagram Followers (shown in the social section)</label><input style={inp} value={form.home_ig_followers} onChange={e => setForm(f => ({ ...f, home_ig_followers: e.target.value }))} placeholder="e.g. 5,000" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
            <button onClick={saveHomeText} disabled={savingHome} style={{ background: 'var(--gd)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '13px 28px', cursor: 'pointer', alignSelf: 'flex-start', opacity: savingHome ? 0.6 : 1 }}>
              {savingHome ? 'Saving...' : 'Save Home Page Text'}
            </button>
          </div>
        </>
      )}

      {/* IMAGES */}
      {settingsTab === 2 && (
        <>
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  color: 'var(--gd)', margin: '0 0 16px' }}>Per-Page Hero Images</div>

          <div style={{ ...section, marginBottom: 16 }}>
            <div style={secHead}>Home Page Hero</div>
            <div style={helpText}>The homepage's hero banner is now managed as a slider with its own admin screen — go to the "Hero Slides" tab to add, edit, and reorder slides.</div>
          </div>
          <HeroImageField field="hero_shop" title="Shop Page Hero" description="Background banner at the top of the Shop page." mobileAspect="3/2"  brand={brand} heroUrls={heroUrls} onUrlChange={(f,v) => setHeroUrls(h => ({...h,[f]:v}))} onSave={saveHeroField} onRemove={removeHeroField} onPositionChange={savePositionField} />
          <MobileHeroImageField field="hero_shop" title="Shop Page Hero"  brand={brand} heroUrls={heroUrls} onUrlChange={(f,v) => setHeroUrls(h => ({...h,[f]:v}))} onSave={saveHeroField} onRemove={removeHeroField} />
          <HeroImageField field="hero_giftcard" title="Gift Card Page Hero" description="Background banner at the top of the Gift Cards page." mobileAspect="3/2"  brand={brand} heroUrls={heroUrls} onUrlChange={(f,v) => setHeroUrls(h => ({...h,[f]:v}))} onSave={saveHeroField} onRemove={removeHeroField} onPositionChange={savePositionField} />
          <MobileHeroImageField field="hero_giftcard" title="Gift Card Page Hero"  brand={brand} heroUrls={heroUrls} onUrlChange={(f,v) => setHeroUrls(h => ({...h,[f]:v}))} onSave={saveHeroField} onRemove={removeHeroField} />
          <HeroImageField field="hero_about" title="About Page Hero" description="Background banner at the top of the About page." mobileAspect="3/2"  brand={brand} heroUrls={heroUrls} onUrlChange={(f,v) => setHeroUrls(h => ({...h,[f]:v}))} onSave={saveHeroField} onRemove={removeHeroField} onPositionChange={savePositionField} />
          <MobileHeroImageField field="hero_about" title="About Page Hero"  brand={brand} heroUrls={heroUrls} onUrlChange={(f,v) => setHeroUrls(h => ({...h,[f]:v}))} onSave={saveHeroField} onRemove={removeHeroField} />
          <div style={section}>
            <div style={secHead}>About Page Side Image</div>
            <div style={helpText}>The image block next to the brand story text on the About page. The block sizes itself to whatever photo you upload -- shown in full, never cropped -- so there's no focal point to set here.</div>
            {brand.about_image && <img src={thumb(brand.about_image, 500)} alt="" style={{ width: '100%', maxWidth: 280, display: 'block', border: '1px solid var(--adm-border)' }} />}
            <MediaUrlField
              value={heroUrls.about_image}
              onChange={v => setHeroUrls(h => ({ ...h, about_image: v }))}
              onSave={url => saveHeroField('about_image', url)}
              placeholder="Paste an image URL..."
              inputStyle={inp}
              folder="brand"
            />
            {brand.about_image && <button onClick={() => removeHeroField('about_image')} style={{ marginTop: 8, background: 'none', border: '1px solid rgba(192,53,43,.4)', color: 'var(--error)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5,  padding: '5px 12px', cursor: 'pointer', alignSelf: 'flex-start' }}>Remove Image</button>}
          </div>
          <HeroImageField field="hero_stories" title="Insights Page Hero" description="Background banner at the top of the Insights page." mobileAspect="3/2"  brand={brand} heroUrls={heroUrls} onUrlChange={(f,v) => setHeroUrls(h => ({...h,[f]:v}))} onSave={saveHeroField} onRemove={removeHeroField} onPositionChange={savePositionField} />
          <MobileHeroImageField field="hero_stories" title="Insights Page Hero"  brand={brand} heroUrls={heroUrls} onUrlChange={(f,v) => setHeroUrls(h => ({...h,[f]:v}))} onSave={saveHeroField} onRemove={removeHeroField} />
          <HeroImageField field="hero_care" title="Help Page Hero" description="Background banner at the top of the Help page." mobileAspect="3/2"  brand={brand} heroUrls={heroUrls} onUrlChange={(f,v) => setHeroUrls(h => ({...h,[f]:v}))} onSave={saveHeroField} onRemove={removeHeroField} onPositionChange={savePositionField} />
          <MobileHeroImageField field="hero_care" title="Help Page Hero"  brand={brand} heroUrls={heroUrls} onUrlChange={(f,v) => setHeroUrls(h => ({...h,[f]:v}))} onSave={saveHeroField} onRemove={removeHeroField} />
          <div style={section}>
            <div style={secHead}>Order Confirmation Email — Hero Image</div>
            <div style={helpText}>Shown at the top of the "Your order is confirmed!" email, next to the greeting. Optional -- the email looks fine without one.</div>
            {brand.order_confirmation_hero_image && <img src={thumb(brand.order_confirmation_hero_image, 500)} alt="" style={{ width: '100%', maxWidth: 280, display: 'block', border: '1px solid var(--adm-border)' }} />}
            <MediaUrlField
              value={heroUrls.order_confirmation_hero_image}
              onChange={v => setHeroUrls(h => ({ ...h, order_confirmation_hero_image: v }))}
              onSave={url => saveHeroField('order_confirmation_hero_image', url)}
              placeholder="Paste an image URL..."
              inputStyle={inp}
              folder="brand"
            />
            {brand.order_confirmation_hero_image && <button onClick={() => removeHeroField('order_confirmation_hero_image')} style={{ marginTop: 8, background: 'none', border: '1px solid rgba(192,53,43,.4)', color: 'var(--error)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5,  padding: '5px 12px', cursor: 'pointer', alignSelf: 'flex-start' }}>Remove Image</button>}
          </div>
        </>
      )}

      {/* VIDEOS */}
      {settingsTab === 3 && (
        <>
        <div style={section}>
          <div style={secHead}>About Page Video ("Our Journey")</div>
          <div style={helpText}>Shown near the top of the About page — both "Our Journey" buttons on the homepage lead here. Upload a video file or paste a video URL.</div>
          {brand.about_video && <video src={brand.about_video} controls style={{ width: '100%', maxWidth: 360, display: 'block', marginBottom: 4, background: '#000', border: '1px solid var(--adm-border)' }} />}
          <MediaUrlField
            value={heroUrls.about_video || ''}
            onChange={v => setHeroUrls(h => ({ ...h, about_video: v }))}
            onSave={url => saveHeroField('about_video', url)}
            placeholder="Paste a video URL..."
            accept="video/*"
            inputStyle={inp}
          />
          {brand.about_video && <button onClick={() => removeHeroField('about_video')} style={{ marginTop: 8, background: 'none', border: '1px solid rgba(192,53,43,.4)', color: 'var(--error)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5,  padding: '5px 12px', cursor: 'pointer', alignSelf: 'flex-start' }}>Remove</button>}

          <div style={{ marginTop: 16 }}>
            <label style={lbl}>Video Caption (shown via the CC button on the About page)</label>
            <textarea style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} rows={2} value={form.about_video_caption} onChange={e => setForm(f => ({ ...f, about_video_caption: e.target.value }))} placeholder="e.g. A quick tour of our latest products." onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} />
            <button onClick={saveAboutCaption} style={{ marginTop: 8, background: 'var(--gd)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5,  padding: '7px 16px', cursor: 'pointer', alignSelf: 'flex-start' }}>Save Caption</button>
          </div>
        </div>
        </>
      )}

      {/* MASTERS */}
      {settingsTab === 4 && (
        <div style={section}>
          <div style={secHead}>Product Categories (Masters)</div>
          <div style={helpText}>Manage the masters (groups) and categories shown in the navbar's category menu and the Shop filter bar. Add or remove masters, and add or remove categories inside each one.</div>

          {taxonomy.map(group => (
            <div key={group.label} style={{ border: '1px solid var(--adm-border)', padding: '14px 16px', background: 'rgba(255,255,255,.4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14,  color: 'var(--iv)' }}>{group.label}</span>
                <button onClick={() => removeGroup(group.label)} style={{ background: 'none', border: '1px solid rgba(192,53,43,.4)', color: 'var(--error)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11,  padding: '4px 10px', cursor: 'pointer' }}>Remove Master</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                {group.items.map(item => (
                  <span key={item} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--adm-fill)', border: '1px solid var(--adm-border)', padding: '5px 6px 5px 10px', fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--iv)' }}>
                    {item}
                    <button
                      onClick={() => toggleComingSoon(item)}
                      title={comingSoon.includes(item) ? 'Marked Coming Soon — click to make available' : 'Mark as Coming Soon'}
                      style={{
                        fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 9.5,  whiteSpace: 'nowrap',
                        background: comingSoon.includes(item) ? 'var(--gold-muted)' : 'none',
                        color: comingSoon.includes(item) ? '#fff' : 'var(--gold-muted)',
                        border: '1px solid var(--gold-muted)', borderRadius: 20, padding: '2px 8px', cursor: 'pointer',
                      }}
                    >{comingSoon.includes(item) ? 'Coming Soon' : 'Mark Soon'}</button>
                    <button onClick={() => removeItem(group.label, item)} aria-label={`Remove ${item}`} style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontWeight: 700, fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
                  </span>
                ))}
                {!group.items.length && <span style={{ ...helpText, fontSize: 13 }}>No categories yet.</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  style={{ ...inp, flex: 1 }}
                  placeholder="New category name..."
                  value={newItemInputs[group.label] || ''}
                  onChange={e => setNewItemInputs(s => ({ ...s, [group.label]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(group.label); } }}
                  onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'}
                />
                <button onClick={() => addItem(group.label)} style={{ background: 'var(--iv)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '10px 16px', cursor: 'pointer' }}>Add</button>
              </div>
            </div>
          ))}
          {!taxonomy.length && <div style={helpText}>No masters yet — add one below.</div>}

          <div style={{ display: 'flex', gap: 8, paddingTop: 10, borderTop: '1px dashed var(--adm-border-strong)' }}>
            <input
              style={{ ...inp, flex: 1 }}
              placeholder="New master name (e.g. Networking)..."
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addGroup(); } }}
              onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'}
            />
            <button onClick={addGroup} style={{ background: 'var(--gd)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '10px 16px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Add Master</button>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={saveTaxonomy} disabled={savingTaxonomy} style={{ background: 'var(--gd)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '13px 28px', cursor: 'pointer', opacity: savingTaxonomy ? 0.6 : 1 }}>
              {savingTaxonomy ? 'Saving...' : 'Save Category Structure'}
            </button>
            <button onClick={resetTaxonomy} style={{ background: 'none', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '13px 20px', cursor: 'pointer' }}>Reset to Default</button>
          </div>
        </div>
      )}

      {/* HELP GUIDES */}
      {settingsTab === 5 && (
        <div style={section}>
          <div style={secHead}>Help Guides</div>
          <div style={helpText}>Shown on the Help page. Each guide covers one topic — an icon character, an optional tagline, its steps (one per line), and an optional highlighted note.</div>

          {careGuides.map((g, i) => (
            <div key={i} style={{ border: '1px solid var(--adm-border)', padding: '16px 18px', background: 'rgba(255,255,255,.4)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13,  color: 'var(--iv)' }}>Guide {i + 1}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {i > 0 && <button onClick={() => moveGuide(i, -1)} title="Move up" style={{ width: 26, height: 26, background: 'var(--adm-fill-2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><AdminIcon name="chevronUp" size={14} /></button>}
                  {i < careGuides.length - 1 && <button onClick={() => moveGuide(i, 1)} title="Move down" style={{ width: 26, height: 26, background: 'var(--adm-fill-2)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><AdminIcon name="chevronDown" size={14} /></button>}
                  <button onClick={() => removeGuide(i)} title="Remove guide" style={{ background: 'none', border: '1px solid rgba(192,53,43,.4)', color: 'var(--error)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11,  padding: '4px 10px', cursor: 'pointer' }}>Remove</button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 10 }}>
                <input style={inp} value={g.material} onChange={e => updateGuide(i, 'material', e.target.value)} placeholder="Topic (e.g. Shipping & Delivery)" />
                <input style={{ ...inp, textAlign: 'center' }} value={g.icon} onChange={e => updateGuide(i, 'icon', e.target.value)} placeholder="◈" />
              </div>
              <input style={inp} value={g.tagline || ''} onChange={e => updateGuide(i, 'tagline', e.target.value)} placeholder="Optional tagline shown under the topic name" />
              <textarea style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} rows={4} value={(g.steps || []).join('\n')} onChange={e => updateGuideSteps(i, e.target.value)} placeholder={'One step per line'} />
              <textarea style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} rows={2} value={g.note || ''} onChange={e => updateGuide(i, 'note', e.target.value)} placeholder="Optional highlighted note" />
            </div>
          ))}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={addGuide} style={{ background: 'none', border: '1px dashed var(--adm-border-strong)', color: 'var(--gd)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '9px 16px', cursor: 'pointer' }}>+ Add Guide</button>
            <button onClick={saveCareGuides} disabled={savingCareGuides} style={{ background: 'var(--gd)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '13px 28px', cursor: 'pointer', opacity: savingCareGuides ? 0.6 : 1 }}>
              {savingCareGuides ? 'Saving...' : 'Save Help Guides'}
            </button>
          </div>
        </div>
      )}

      {/* DELIVERY */}
      {settingsTab === 6 && (
        <div style={section}>
          <div style={secHead}>Delivery Estimates</div>
          <div style={helpText}>Each product has its own base delivery window (set on the product's Add/Edit page). Cities listed below get that estimate as-is; anywhere else automatically gets the extra days added on top. This is an estimate you control, not a live courier tracking figure.</div>
          <div>
            <label style={lbl}>Fast-Delivery Cities (comma-separated)</label>
            <textarea style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} rows={3} value={form.delivery_metro_cities} onChange={e => setForm(f => ({ ...f, delivery_metro_cities: e.target.value }))} placeholder="Tiruppur, Coimbatore, Chennai, Bangalore, Mumbai, Delhi..." onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} />
          </div>
          <div style={{ maxWidth: 260 }}>
            <label style={lbl}>Extra Days for Other Cities</label>
            <input style={inp} type="number" min="0" value={form.delivery_extra_days} onChange={e => setForm(f => ({ ...f, delivery_extra_days: e.target.value }))} onWheel={e => e.currentTarget.blur()} onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} />
          </div>
          <button onClick={saveDeliverySettings} disabled={savingDelivery} style={{ background: 'var(--gd)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '13px 28px', cursor: 'pointer', alignSelf: 'flex-start', opacity: savingDelivery ? 0.6 : 1 }}>
            {savingDelivery ? 'Saving...' : 'Save Delivery Settings'}
          </button>
        </div>
      )}
    </div>
  );
}


// ── DASHBOARD: ICONS, STAT TILES, CHARTS ──
const DASH_ICON_PATHS = {
  box: <><path d="M3 7.5l9-4 9 4-9 4-9-4z" /><path d="M3 7.5v9l9 4 9-4v-9" /><path d="M12 11.5v9" /></>,
  orders: <><rect x="3.5" y="7.5" width="17" height="13" rx="2" /><path d="M8 7.5V6a4 4 0 0 1 8 0v1.5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 3.2" /></>,
  chat: <><path d="M21 11.5a8.4 8.4 0 0 1-8.4 8.4 8.3 8.3 0 0 1-3.9-.96L3 21l1.96-5.7a8.3 8.3 0 0 1-.96-3.9A8.4 8.4 0 0 1 12.5 3a8.4 8.4 0 0 1 8.4 8.4z" /></>,
  warning: <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
};
// Small inline outline-SVG icons for the handful of admin controls that used
// plain Unicode glyphs (arrows, a star, a warning triangle) -- consistent
// stroke-based style with DashIcon below, never emoji/system-font glyphs
// that render inconsistently across OS/browser.
function AdminIcon({ name, size = 14, filled = false, color = 'currentColor' }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', style: { display: 'inline-block', verticalAlign: '-2px' } };
  switch (name) {
    case 'chevronUp': return <svg {...common} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 15 12 9 18 15" /></svg>;
    case 'chevronDown': return <svg {...common} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>;
    case 'arrowLeft': return <svg {...common} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>;
    case 'warning': return <svg {...common} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
    case 'star': return <svg {...common} fill={filled ? color : 'none'} stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>;
    case 'triangleUp': return <svg {...common} fill={filled ? color : 'none'} stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 4 21 19 3 19" /></svg>;
    default: return null;
  }
}
function DashIcon({ type, color, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {DASH_ICON_PATHS[type]}
    </svg>
  );
}
// Single accent for the whole dashboard (stat tiles + both charts) -- was
// four unrelated per-tile hues (purple/amber/red/teal) that didn't match
// anywhere else in the site's own cream/ink/gold palette.
const DASH_ACCENT = '#0F766E';

// Order-card status pill -- semantic color (progress vs. cancelled) kept
// separate from DASH_ACCENT, and drawn from the same --success/--error
// tokens already used elsewhere in this file rather than inventing new hues.
function statusPillStyle(status) {
  switch (status) {
    case 'Cancelled': return { bg: '#FDE9E7', fg: '#C0352B' };
    case 'Delivered': return { bg: '#E3F6EE', fg: '#0F7B53' };
    case 'Shipped': case 'Out for Delivery': return { bg: '#E6EFFE', fg: '#1D5FD1' };
    case 'Paid': case 'Confirmed': return { bg: '#E4F6F3', fg: '#0F766E' };
    default: return { bg: '#FFF1D6', fg: '#A15C00' }; // Pending
  }
}

const KPI_TONES = {
  primary: { bg: '#E4F6F3', fg: '#0F766E' },
  info: { bg: '#E6EFFE', fg: '#1D5FD1' },
  warning: { bg: '#FFF1D6', fg: '#A15C00' },
  success: { bg: '#E3F6EE', fg: '#0F7B53' },
  danger: { bg: '#FDE9E7', fg: '#C0352B' },
};
function StatTile({ type, tone = 'primary', value, label, error, onRetry, onClick }) {
  const t = KPI_TONES[tone] || KPI_TONES.primary;
  const clickable = typeof onClick === 'function' && !error;
  return (
    <div
      className={`adm-card adm-kpi${clickable ? ' is-link' : ''}`}
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }) : undefined}
    >
      <div className="adm-kpi-ico" style={{ background: t.bg }}>
        <DashIcon type={type} color={t.fg} />
      </div>
      <div>
        {error ? (
          <>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--error)' }}>Unable to load</div>
            <button type="button" onClick={onRetry} style={{ background: 'none', border: 'none', padding: 0, marginTop: 6, fontWeight: 700, fontSize: 13, color: 'var(--primary)', cursor: 'pointer' }}>Retry</button>
          </>
        ) : (
          <div className="adm-kpi-val">{value}</div>
        )}
        <div className="adm-kpi-label">{label}</div>
      </div>
    </div>
  );
}

// Single-series area/line — order volume per day, last 14 days, with a hover crosshair + tooltip
function OrdersTrendChart({ orders, color }) {
  const [hoverIdx, setHoverIdx] = React.useState(null);
  const days = React.useMemo(() => {
    const arr = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      arr.push({ date: d, count: 0 });
    }
    orders.forEach(o => {
      if (!o.created_at) return;
      const od = new Date(o.created_at);
      od.setHours(0, 0, 0, 0);
      const match = arr.find(a => a.date.getTime() === od.getTime());
      if (match) match.count++;
    });
    return arr;
  }, [orders]);

  const max = Math.max(1, ...days.map(d => d.count));
  const W = 560, H = 160, padL = 6, padR = 6, padT = 14, padB = 4;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const stepX = plotW / (days.length - 1);
  const points = days.map((d, i) => ({ x: padL + i * stepX, y: padT + plotH - (d.count / max) * plotH, ...d }));
  const linePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
  const areaPath = linePath + ` L${points[points.length - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)} L${points[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;
  const hp = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block', overflow: 'visible' }} onMouseLeave={() => setHoverIdx(null)}>
        <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke="#DCE9E6" strokeWidth="1" />
        <path d={areaPath} fill={color} opacity="0.12" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hp && <line x1={hp.x} y1={padT} x2={hp.x} y2={padT + plotH} stroke="#C3D9D4" strokeWidth="1" />}
        {points.map((p, i) => (
          <g key={i}>
            <rect x={p.x - stepX / 2} y={0} width={stepX} height={H} fill="transparent" onMouseEnter={() => setHoverIdx(i)} style={{ cursor: 'pointer' }} />
            {i === hoverIdx && <circle cx={p.x} cy={p.y} r="4.5" fill={color} stroke="#fff" strokeWidth="2" />}
          </g>
        ))}
      </svg>
      {hp && (
        <div style={{ position: 'absolute', left: `${(hp.x / W) * 100}%`, top: 0, transform: 'translate(-50%,-100%)', marginTop: -8, background: 'var(--iv)', color: '#fff', padding: '7px 11px', borderRadius: 4, fontSize: 12.5, fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 2 }}>
          <div style={{ fontWeight: 700 }}>{hp.count} order{hp.count !== 1 ? 's' : ''}</div>
          <div style={{ opacity: 0.7, fontSize: 11, marginTop: 1 }}>{hp.date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontFamily: 'var(--font-body)', fontSize: 10.5, color: 'var(--adm-body)' }}>
        <span>{points[0].date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
        <span>{points[points.length - 1].date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
      </div>
    </div>
  );
}

// Sequential single-hue horizontal bars — magnitude comparison across order statuses
function StatusBreakdownChart({ orders, color }) {
  const counts = React.useMemo(
    () => STATUSES.map(s => ({ status: s, count: orders.filter(o => (o.status || 'Pending') === s).length })),
    [orders]
  );
  const max = Math.max(1, ...counts.map(c => c.count));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      {counts.map(c => (
        <div key={c.status} style={{ display: 'flex', alignItems: 'center', gap: 10 }} title={`${c.status}: ${c.count}`}>
          <div style={{ width: 112, flexShrink: 0, fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11.5,  color: 'var(--adm-body)' }}>{c.status}</div>
          <div style={{ flex: 1, height: 15, background: 'var(--adm-fill)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ width: `${(c.count / max) * 100}%`, minWidth: c.count > 0 ? 6 : 0, height: '100%', background: color, borderRadius: 8, transition: 'width 0.3s ease' }} />
          </div>
          <div style={{ width: 24, textAlign: 'right', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, color: 'var(--iv)' }}>{c.count}</div>
        </div>
      ))}
    </div>
  );
}

// ── MAIN ADMIN ────────────────────────────────────────────
// ── NAVIGATION (sidebar groups; indexes are the tab numbers used by the tab-content blocks below) ──
const TAB_NAV = [
  { group: 'Overview', items: [{ i: 0, label: 'Dashboard', icon: 'dashboard' }] },
  { group: 'Catalogue', items: [{ i: 1, label: 'Products', icon: 'box' }, { i: 2, label: 'Add Product', icon: 'plus' }, { i: 13, label: 'Stock Alerts', icon: 'bell' }] },
  { group: 'Sales', items: [{ i: 3, label: 'Orders', icon: 'cart' }, { i: 4, label: 'Enquiries', icon: 'chat' }, { i: 6, label: 'Coupons', icon: 'tag' }, { i: 7, label: 'Gift Cards', icon: 'gift' }] },
  { group: 'Storefront', items: [{ i: 9, label: 'Banners', icon: 'image' }, { i: 5, label: 'Blog Posts', icon: 'doc' }, { i: 8, label: 'Store Settings', icon: 'cog' }] },
  { group: 'Messaging', items: [{ i: 11, label: 'Email Templates', icon: 'mail' }, { i: 12, label: 'WhatsApp Templates', icon: 'wa' }, { i: 10, label: 'Email Test', icon: 'send' }] },
];
const TAB_META = {
  0: ['Dashboard', "Here's what's happening in your store"],
  1: ['Products', 'Manage your catalogue, stock and visibility'],
  2: ['Add / Edit Product', 'Create a new listing or update an existing one'],
  3: ['Orders', 'Track payments, fulfilment and delivery'],
  4: ['Enquiries', 'Customer questions from the store and WhatsApp'],
  5: ['Blog Posts', 'Articles shown on the Blog page'],
  6: ['Coupons', 'Discount codes for your customers'],
  7: ['Gift Cards', 'Issued gift cards and balances'],
  8: ['Store Settings', 'Brand, home page, images, categories and delivery'],
  9: ['Banners', 'Slides shown at the top of the home page'],
  10: ['Email Test', 'Send a test email to check your sender setup'],
  11: ['Email Templates', 'Order and notification emails'],
  12: ['WhatsApp Templates', 'Order update messages'],
  13: ['Stock Alerts', 'Customers waiting for products to come back'],
};
function NavIcon({ name, size = 19 }) {
  const c = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { flexShrink: 0 } };
  switch (name) {
    case 'dashboard': return <svg {...c}><rect x="3" y="3" width="7.5" height="9" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" /><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.5" /><rect x="3" y="15" width="7.5" height="6" rx="1.5" /></svg>;
    case 'box': return <svg {...c}><path d="M3 7.5l9-4 9 4-9 4-9-4z" /><path d="M3 7.5v9l9 4 9-4v-9" /><path d="M12 11.5v9" /></svg>;
    case 'plus': return <svg {...c}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>;
    case 'bell': return <svg {...c}><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" /></svg>;
    case 'cart': return <svg {...c}><circle cx="9" cy="20" r="1.3" /><circle cx="18" cy="20" r="1.3" /><path d="M2 3h3l2.7 12.4a2 2 0 002 1.6h8.2a2 2 0 002-1.5L21.5 8H6" /></svg>;
    case 'chat': return <svg {...c}><path d="M21 11.5a8.4 8.4 0 01-8.4 8.4 8.3 8.3 0 01-3.9-.96L3 21l1.96-5.7a8.3 8.3 0 01-.96-3.9A8.4 8.4 0 0112.5 3a8.4 8.4 0 018.5 8.5z" /></svg>;
    case 'tag': return <svg {...c}><path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z" /><circle cx="7.5" cy="7.5" r="1.3" /></svg>;
    case 'gift': return <svg {...c}><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M12 8v13M3 12.5h18M12 8c-2-4-6-3-5 0 .5 1.3 3 1 5 0zM12 8c2-4 6-3 5 0-.5 1.3-3 1-5 0z" /></svg>;
    case 'image': return <svg {...c}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.7" /><path d="M21 16l-5-5-9 9" /></svg>;
    case 'doc': return <svg {...c}><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>;
    case 'cog': return <svg {...c}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>;
    case 'mail': return <svg {...c}><rect x="2.5" y="4.5" width="19" height="15" rx="2" /><path d="M22 7l-10 6.5L2 7" /></svg>;
    case 'wa': return <svg {...c}><path d="M3 21l1.65-4.9A8.5 8.5 0 1112 20.5a8.5 8.5 0 01-4.1-1.05L3 21z" /><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-.8.7a3.5 3.5 0 01-1.7-1.7l.7-.8-1-2L9 9.5z" /></svg>;
    case 'send': return <svg {...c}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>;
    case 'close': return <svg {...c}><path d="M18 6L6 18M6 6l12 12" /></svg>;
    case 'menu': return <svg {...c}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
    case 'search': return <svg {...c}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></svg>;
    case 'store': return <svg {...c}><path d="M3 9l1.5-5h15L21 9" /><path d="M3 9a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0" /><path d="M5 12v8h14v-8" /></svg>;
    case 'logout': return <svg {...c}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></svg>;
    default: return null;
  }
}

function AdminSkeleton({ rows = 5 }) {
  return (
    <div className="adm-card adm-card-pad" role="status" aria-label="Loading" style={{ display: 'grid', gap: 14 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div className="adm-skel" style={{ width: 44, height: 44, flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'grid', gap: 8 }}>
            <div className="adm-skel" style={{ height: 12, width: `${60 + (i % 3) * 12}%` }} />
            <div className="adm-skel" style={{ height: 10, width: `${30 + (i % 2) * 20}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function AdminPager({ page, pages, total, pageSize, onPage }) {
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const nums = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  const btn = (active, disabled) => ({ minWidth: 36, height: 36, padding: '0 10px', borderRadius: 8, border: `1px solid ${active ? 'var(--primary)' : 'var(--adm-border)'}`, background: active ? 'var(--primary)' : '#fff', color: active ? '#fff' : 'var(--adm-body)', fontWeight: 600, fontSize: 13.5, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .5 : 1 });
  return (
    <nav aria-label="Pagination" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
      <div style={{ fontSize: 13.5, color: 'var(--adm-muted)' }}>Showing {from}–{to} of {total}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button type="button" style={btn(false, page === 1)} disabled={page === 1} onClick={() => onPage(page - 1)} aria-label="Previous page">‹</button>
        {nums.map((n, i) => n === '…'
          ? <span key={'e' + i} style={{ color: 'var(--adm-muted)', padding: '0 4px' }}>…</span>
          : <button key={n} type="button" style={btn(n === page, false)} onClick={() => onPage(n)} aria-current={n === page ? 'page' : undefined}>{n}</button>)}
        <button type="button" style={btn(false, page === pages)} disabled={page === pages} onClick={() => onPage(page + 1)} aria-label="Next page">›</button>
      </div>
    </nav>
  );
}

function AdminEmpty({ icon = 'box', title, hint }) {
  return (
    <div className="adm-empty" role="status">
      <NavIcon name={icon} size={36} />
      <div style={{ fontWeight: 700, color: 'var(--adm-ink)', fontSize: 15 }}>{title}</div>
      {hint && <div style={{ fontSize: 13.5, maxWidth: 420, margin: '4px auto 0' }}>{hint}</div>}
    </div>
  );
}

export default function Admin() {
  const { isAdmin, logout, currentUser } = useAuth();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const liveCats = categoriesFor(effectiveTaxonomy(brand));
  const [tab, setTab] = useState(0);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [enquiries, setEnquiries] = useState([]);
  // Independent per-section status -- NOT one shared `loading` boolean. The
  // three dashboard datasets used to be fetched as a single Promise.all with
  // one shared timeout: if any ONE of them was slow, the whole batch was
  // treated as failed and every section fell back to its default empty
  // array, which a naive `loading ? '—' : products.length` then displayed as
  // a real "0" -- indistinguishable from the database genuinely having zero
  // rows. Each section now tracks its own 'loading' | 'success' | 'error', so
  // one slow/failed endpoint no longer blanks out the other two, and a
  // failure renders as an explicit "Unable to load" + Retry, never a 0.
  const [productsStatus, setProductsStatus] = useState('loading');
  const [ordersStatus, setOrdersStatus] = useState('loading');
  const [enquiriesStatus, setEnquiriesStatus] = useState('loading');
  const [form, setForm] = useState({ ...EMPTY });
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [orderStatusFilter, setOrderStatusFilter] = useState('All');
  const [orderDateFrom, setOrderDateFrom] = useState('');
  const [orderDateTo, setOrderDateTo] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productCatFilter, setProductCatFilter] = useState('All');
  const [productStockFilter, setProductStockFilter] = useState('All');
  const [productVisibilityFilter, setProductVisibilityFilter] = useState('All');
  const [enquiryStatusFilter, setEnquiryStatusFilter] = useState('All');
  const [enquirySearch, setEnquirySearch] = useState('');
  const [productSort, setProductSort] = useState({ key: null, dir: 1 });
  const [orderSearch, setOrderSearch] = useState('');
  const [orderNeedsReviewOnly, setOrderNeedsReviewOnly] = useState(false); // FLOW-7 quick filter
  // "Set & Notify" template picker -- notifyOrderId is which order's picker
  // is open (null = none), orderTemplates is the enabled order-lifecycle
  // template list (fetched once, lazily, on first open), notifyTemplateId is
  // the currently-selected option, notifySending guards against a double-click.
  const [notifyOrderId, setNotifyOrderId] = useState(null);
  const [notifyTemplateId, setNotifyTemplateId] = useState('');
  const [notifySending, setNotifySending] = useState(false);
  const [orderTemplates, setOrderTemplates] = useState(null);
  // Same shape, separate state -- a distinct picker + Send button for
  // WhatsApp, independent of the email one above (same "Set & Notify" open
  // trigger, two separate notify actions underneath it).
  const [waNotifyTemplateId, setWaNotifyTemplateId] = useState('');
  const [waNotifySending, setWaNotifySending] = useState(false);
  const [orderWhatsAppTemplates, setOrderWhatsAppTemplates] = useState(null);
  // Phase 8 -- two-step delete (DELETE ORDER -> explicit "are you sure" ->
  // confirmed action). *ConfirmId tracks which single row is showing the
  // "are you sure" step (null = none); *DeletingId additionally guards the
  // confirmed action itself against a double-click while the request is
  // in flight. Orders are soft-deleted (see softDeleteOrder below); enquiries
  // are hard-deleted (see deleteEnquiry below) -- same two-step UI either way.
  const [orderDeleteConfirmId, setOrderDeleteConfirmId] = useState(null);
  const [orderDeletingId, setOrderDeletingId] = useState(null);
  const [enquiryDeleteConfirmId, setEnquiryDeleteConfirmId] = useState(null);
  const [enquiryDeletingId, setEnquiryDeletingId] = useState(null);

  // Guards every async dashboard operation below (initial load AND manual
  // per-section retries) against updating state after this component is gone
  // -- simpler and more robust than the old per-effect `cancelled` closure,
  // since a manual retry (triggered by a click, not an effect re-run) needs
  // the exact same protection.
  const mountedRef = React.useRef(true);
  // Re-armed on every mount: React.StrictMode (dev server) mounts, unmounts and re-mounts effects once,
  // which used to leave this false for good and silently stop every dashboard fetch below.
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // FLOW-3: the stock snapshot the product edit form last loaded (base + per-
  // variant, keyed by size) -- read in editProduct() below, compared against a
  // fresh read of the DB at save time so saveProduct() can tell "the admin
  // actually changed this stock value" apart from "this is just what the form
  // happened to load," and never let the latter silently overwrite a sale that
  // happened while the form was open. null when adding a new product.
  const loadedProductRef = React.useRef(null);
  const hasCoverColumnsRef = React.useRef(false); // does the product row being edited have the optional video-cover columns?
  // Kept in sync with `editId` so an in-flight editProduct() re-fetch (below)
  // can tell it's still editing the same product before applying what it got
  // back, instead of clobbering a form the admin has since moved away from
  // (Cancel, Add New, or opening a different product) with stale data.
  const editIdRef = React.useRef(null);
  useEffect(() => { editIdRef.current = editId; }, [editId]);

  // currentUser is a new object reference every time Supabase fires an auth event
  // (TOKEN_REFRESHED, redundant SIGNED_IN on tab focus, etc.), even when it's the
  // same logged-in session -- depending on the object itself re-ran this effect
  // on every one of those events. Keying off the stable id stops that outright.
  useEffect(() => {
    if (!currentUser) { navigate('/admin/login'); return; }
    if (!isAdmin) {
      navigate('/');
      return;
    }
    loadDashboard();
  }, [currentUser?.id, isAdmin]);

  // Fetches one dashboard dataset (products/orders/enquiries) independently --
  // its own status, its own bounded retry with backoff, its own timeout. A
  // slow or failed table no longer touches the other two: each only ever
  // calls its own setStatus/setData, so one endpoint timing out can't blank
  // out sections that already loaded successfully (this used to all run as a
  // single Promise.all with one shared timeout, so any one slow query failed
  // the whole batch and reset every section to its default empty array --
  // indistinguishable on screen from the database genuinely having 0 rows).
  //
  // Root cause of the actual timeouts: supabase-js resolves the access token
  // for EVERY query via auth.getSession() internally (SupabaseClient.
  // _getAccessToken), and if the cached session is past its expiry margin,
  // that call transparently performs a token refresh first -- a real network
  // request with no timeout of its own anywhere in the SDK (confirmed by
  // reading node_modules/@supabase/auth-js: _refreshAccessToken's retry logic
  // only retries actual fetch errors, never a stall with no response). Three
  // concurrent queries all hit this same internal refresh at once; if THAT
  // stalls, all three hang together with nothing to rescue them but our own
  // outer timeout -- which is exactly "fetchAll failed after retry: Error:
  // Request timed out" with every section reading 0 simultaneously. This is
  // why it was intermittent (only when the token happened to need refreshing
  // at that exact moment) and why a refresh "fixed" it (a fresh page load
  // re-triggers AuthContext's own session check, which -- if the underlying
  // stall was transient -- simply succeeds the second time). See
  // ensureFreshSession's call site in loadDashboard() below for the fix.
  async function fetchSection(table, setData, setStatus) {
    setStatus('loading');
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!mountedRef.current) return;
      const startedAt = Date.now();
      const timeoutMs = attempt < maxAttempts ? 10000 : 15000;
      try {
        const { data, error } = await withTimeout(
          supabase.from(table).select('*').order('created_at', { ascending: false }),
          timeoutMs
        );
        if (!mountedRef.current) return;
        // A tab left open and idle for a long time (overnight, a sleeping laptop)
        // can let the login session quietly expire in the background.
        if (isAuthExpiredError(error)) {
          toast.error('Your session has expired -- please sign in again.');
          navigate('/admin/login');
          return;
        }
        if (error) throw error;
        setData(data || []);
        setStatus('success');
        return;
      } catch (e) {
        if (!mountedRef.current) return;
        // eslint-disable-next-line no-console
        console.error(`[Admin dashboard] ${table} fetch failed`, {
          attempt, of: maxAttempts, durationMs: Date.now() - startedAt, reason: e.message || String(e),
        });
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, 400 * attempt)); // short backoff: 400ms, 800ms
          continue;
        }
        setStatus('error');
      }
    }
  }

  async function loadDashboard() {
    // Proactively resolves (and, if needed, refreshes) the session BEFORE the
    // three dashboard queries fire, instead of letting each one lazily -- and
    // unprotected -- trigger that same refresh internally on demand. See the
    // long comment on fetchSection above for exactly why this matters: this
    // one call, wrapped in OUR OWN timeout, turns an unattributable triple
    // hang into one clear, correctly-labeled failure.
    const { error: sessionErr } = await safeQuery(supabase.auth.getSession(), 8000);
    if (!mountedRef.current) return;
    if (sessionErr) {
      // eslint-disable-next-line no-console
      console.error('[Admin dashboard] session check failed before loading', sessionErr);
      toast.error('Your session could not be verified -- please sign in again.');
      navigate('/admin/login');
      return;
    }
    fetchSection('products', setProducts, setProductsStatus);
    fetchSection('orders', setOrders, setOrdersStatus);
    fetchSection('enquiries', setEnquiries, setEnquiriesStatus);
  }

  function retryProducts() { fetchSection('products', setProducts, setProductsStatus); }
  function retryOrders() { fetchSection('orders', setOrders, setOrdersStatus); }
  function retryEnquiries() { fetchSection('enquiries', setEnquiries, setEnquiriesStatus); }

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function addVariant() {
    setForm(f => ({ ...f, variants: [...(f.variants || []), { size: '', price: '', weight: '', dimensions: '', stock: '' }] }));
  }
  function updateVariant(i, key, val) {
    setForm(f => ({ ...f, variants: f.variants.map((v, idx) => idx === i ? { ...v, [key]: val } : v) }));
  }
  function removeVariant(i) {
    setForm(f => ({ ...f, variants: f.variants.filter((_, idx) => idx !== i) }));
  }
  // Variant order is functionally significant -- ProductPage.jsx auto-selects
  // the first in-stock variant as the default shown to customers -- but the
  // only way to change it used to be deleting and re-adding rows in the new
  // order. Mirrors CareGuidesManager's moveGuide().
  function moveVariant(i, dir) {
    setForm(f => {
      const arr = [...(f.variants || [])];
      const target = i + dir;
      if (target < 0 || target >= arr.length) return f;
      [arr[i], arr[target]] = [arr[target], arr[i]];
      return { ...f, variants: arr };
    });
  }

  async function saveProduct() {
    if (!form.name.trim()) { toast.error('Product name is required.'); return; }
    const realVariants = (form.variants || []).filter(v => (v.size || '').trim());
    // A non-enquiry product with no price (and no priced variants standing in for
    // one) used to save fine and go live at an effective ₹0 -- the field has no
    // asterisk and nothing else caught it.
    if (!form.enquiry_only && realVariants.length === 0 && (form.price === '' || form.price === null)) {
      toast.error('Price is required (or mark this product as Enquiry Only, or add priced variants).');
      return;
    }
    if (form.price !== '' && Number(form.price) < 0) { toast.error('Price cannot be negative.'); return; }
    if (form.shipping_charge !== '' && Number(form.shipping_charge) < 0) { toast.error('Shipping charge cannot be negative.'); return; }
    if (Number(form.stock) < 0) { toast.error('Stock cannot be negative.'); return; }
    for (const v of realVariants) {
      if (!form.enquiry_only && (v.price === '' || v.price === null || v.price === undefined)) { toast.error(`Variant "${v.size}" needs a price.`); return; }
      if (v.price !== '' && Number(v.price) < 0) { toast.error(`Variant "${v.size}" price cannot be negative.`); return; }
      if (v.stock !== '' && v.stock !== null && v.stock !== undefined && Number(v.stock) < 0) { toast.error(`Variant "${v.size}" stock cannot be negative.`); return; }
    }
    // SEC-XSS-3: an admin-entered link is trusted enough to render as a real
    // <a href> on the live product page -- reject anything safeHref() itself
    // wouldn't put in an href (javascript:, data:, etc.) rather than saving it.
    if (form.pinterest_url.trim() && !safeHref(form.pinterest_url.trim())) {
      toast.error('Pinterest Pin URL looks unsafe or invalid -- please check it and try again.');
      return;
    }
    setSaving(true);
    try {
      // FLOW-3: never let this save silently undo a stock change (a sale, a
      // manual correction) that happened elsewhere while this form was open.
      // Re-read the live row's stock right now and, for any stock value the
      // admin did NOT actually change from what the form originally loaded
      // (loadedProductRef, set in editProduct() above), keep the fresh
      // database value instead of this form's own, now possibly-stale, copy
      // of it. A value the admin DID change always wins -- three-way merge
      // (loaded vs. live vs. admin-edited), never a blind overwrite either way.
      let liveBaseStock = null;
      const liveVariantStock = new Map();
      if (editId) {
        const { data: liveRow } = await safeQuery(supabase.from('products').select('stock, variants').eq('id', editId).maybeSingle());
        if (liveRow) {
          liveBaseStock = liveRow.stock;
          (liveRow.variants || []).forEach(v => { if ((v.size || '').trim()) liveVariantStock.set(v.size.trim(), v.stock); });
        }
      }
      const loaded = loadedProductRef.current;
      // null/undefined/'' all mean the same "untracked" thing -- compared as
      // one normalized value so e.g. loaded=null vs. form='' never reads as
      // "the admin changed this" when nothing actually changed.
      const normStock = (v) => (v === '' || v === null || v === undefined) ? null : (Number(v) || 0);
      const baseStockUnchanged = !!(editId && loaded && normStock(form.stock) === normStock(loaded.stock));
      const finalBaseStock = (baseStockUnchanged && liveBaseStock !== null) ? (Number(liveBaseStock) || 0) : (Number(form.stock) || 0);
      const loadedVariantStock = new Map((loaded?.variants || []).map(v => [(v.size || '').trim(), v.stock]));

      const data = {
        ...form,
        price: form.enquiry_only ? null : (form.price !== '' && !isNaN(Number(form.price)) ? Number(form.price) : null),
        shipping_charge: form.shipping_charge !== '' && !isNaN(Number(form.shipping_charge)) ? Number(form.shipping_charge) : 0,
        stock: finalBaseStock,
        // !== '' (not ||) so an admin who deliberately types 0 (same-day/
        // ready-stock item) isn't silently coerced back to the default --
        // matches the price/shipping_charge pattern just above.
        delivery_min_days: form.delivery_min_days !== '' && !isNaN(Number(form.delivery_min_days)) ? Number(form.delivery_min_days) : 5,
        delivery_max_days: form.delivery_max_days !== '' && !isNaN(Number(form.delivery_max_days)) ? Number(form.delivery_max_days) : 8,
        fulfillment_type: form.fulfillment_type === 'made_to_order' ? 'made_to_order' : 'ready_to_ship',
        variants: (form.variants || [])
          .filter(v => (v.size || '').trim())
          .map(v => {
            // Unlike the base Stock field (explicitly labeled "0 = Sold Out"), a blank
            // variant stock means "not tracked, always available" -- the same
            // convention knownStock() and the rest of the app already use. Coercing it
            // to 0 here silently marked every newly-added, stock-left-blank variant as
            // permanently sold out.
            const size = v.size.trim();
            const stockRaw = typeof v.stock === 'string' ? v.stock.trim() : v.stock;
            const formStock = normStock(stockRaw);
            // A variant that already existed when the form loaded, whose stock the
            // admin left exactly as loaded -- take the live value instead. A brand
            // new variant (added in this session) has no loaded baseline at all, so
            // it always keeps whatever the admin typed.
            const hadLoadedValue = loadedVariantStock.has(size);
            const variantUnchanged = hadLoadedValue && normStock(loadedVariantStock.get(size)) === formStock;
            const stock = (variantUnchanged && liveVariantStock.has(size)) ? liveVariantStock.get(size) : formStock;
            return { size, price: Number(v.price) || 0, weight: v.weight || '', dimensions: v.dimensions || '', stock };
          }),
      };
      delete data.id;
      // video_cover_url / video_cover_position / video_position are additive columns. Only send them when
      // they have a value worth persisting, or when the row being edited already has the columns (so
      // clearing a cover, or a video_position of exactly 0, still saves) -- otherwise a database without
      // them yet would reject the whole product save.
      for (const key of ['video_cover_url', 'video_cover_position']) {
        if (data[key]) continue;
        if (editId && hasCoverColumnsRef.current) data[key] = null; else delete data[key];
      }
      // video_position (0 = "video leads") is meaningfully 0, not "unset" -- it can't use the same
      // falsy-value check the two string cover fields above use.
      if (data.video_url && hasCoverColumnsRef.current) data.video_position = Math.max(0, Number(data.video_position) || 0);
      else delete data.video_position;
      if (editId) {
        const { error, timedOut } = await safeQuery(supabase.from('products').update({ ...data, updated_at: new Date().toISOString() }).eq('id', editId));
        if (timedOut) throw new Error('Timed out -- check your connection and try again.');
        if (error) throw error;
        toast.success('Product updated.');
      } else {
        const { error, timedOut } = await safeQuery(supabase.from('products').insert(data));
        if (timedOut) throw new Error('Timed out -- check your connection and try again.');
        if (error) throw error;
        toast.success('Product added.');
      }
      setForm({ ...EMPTY }); setEditId(null); loadedProductRef.current = null;
      await retryProducts(); setTab(1);
    } catch (e) {
      if (isAuthExpiredError(e)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
      toast.error('Failed: ' + e.message);
    }
    finally { setSaving(false); }
  }

  async function deleteProduct(p) {
    if (!window.confirm(`Delete "${p.name}"?`)) return;
    const { error, timedOut } = await safeQuery(supabase.from('products').delete().eq('id', p.id));
    if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
    if (timedOut) { toast.error('Timed out deleting product -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed: ' + error.message); return; }
    deleteFromStorage(p.images);
    toast.success('Deleted.'); await retryProducts();
  }

  // Shared by editProduct()'s optimistic first render and its live re-fetch
  // below -- same field-by-field defaulting either way, so the two can never
  // drift into showing different values for the same underlying row.
  function buildProductFormState(row) {
    // Some older products have two labels crammed into one badge field with a
    // "|" separator (a manual workaround from before a second badge field existed).
    // Split those into badge/badge2 on load so re-saving stores them cleanly.
    let badge = row.badge || '', badge2 = row.badge2 || '';
    if (!badge2 && badge.includes('|')) {
      const [first, ...rest] = badge.split('|').map(s => s.trim()).filter(Boolean);
      badge = first || ''; badge2 = rest.join(' | ');
    }
    return { ...EMPTY, ...row, badge, badge2, images: row.images || [], image_position: row.image_position || '50% 50%', pinterest_url: row.pinterest_url || '', variants: row.variants || [], allow_enquiry: row.allow_enquiry !== false, delivery_min_days: row.delivery_min_days ?? 5, delivery_max_days: row.delivery_max_days ?? 8, fulfillment_type: row.fulfillment_type === 'made_to_order' ? 'made_to_order' : 'ready_to_ship', video_url: row.video_url || '', video_position: row.video_position ?? 0, shipping_charge: row.shipping_charge ?? '', show_shipping_at_checkout: row.show_shipping_at_checkout !== false };
  }
  // FLOW-3: the row a click here came from (the Products list) was fetched once,
  // whenever the dashboard last loaded -- possibly minutes ago, and stale if a
  // sale (or another admin) has changed this product's stock since. Show it
  // immediately so opening the form has no visible delay, then silently
  // re-fetch the live row right after; loadedProductRef ends up holding
  // whichever stock values actually made it into the form, which saveProduct()
  // below then diffs against a second, save-time read of the database.
  async function editProduct(p) {
    setForm(buildProductFormState(p));
    loadedProductRef.current = { stock: p.stock, variants: (p.variants || []).map(v => ({ size: v.size, stock: v.stock })) };
    hasCoverColumnsRef.current = 'video_cover_url' in p;
    setEditId(p.id); setTab(2);
    const { data: fresh } = await safeQuery(supabase.from('products').select('*').eq('id', p.id).maybeSingle());
    // Nothing came back (deleted/network issue), or the admin has already
    // moved on to something else (Cancel, Add New, a different product) --
    // either way, applying this now would be stale or simply wrong.
    if (!fresh || editIdRef.current !== p.id) return;
    setForm(buildProductFormState(fresh));
    loadedProductRef.current = { stock: fresh.stock, variants: (fresh.variants || []).map(v => ({ size: v.size, stock: v.stock })) };
    hasCoverColumnsRef.current = 'video_cover_url' in fresh;
  }

  async function toggleFeatured(p) {
    const { error, timedOut } = await safeQuery(supabase.from('products').update({ featured: !p.featured }).eq('id', p.id));
    if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
    if (timedOut) { toast.error('Timed out -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed to update. Run the featured SQL migration in Supabase if this keeps failing.'); return; }
    toast.success(p.featured ? 'Removed from Homepage showcase.' : 'Pinned to Homepage showcase.');
    await retryProducts();
  }

  async function toggleDiscoverPin(p) {
    const { error, timedOut } = await safeQuery(supabase.from('products').update({ discover_pinned: !p.discover_pinned }).eq('id', p.id));
    if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
    if (timedOut) { toast.error('Timed out -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed to update. Run the discover_pinned SQL migration in Supabase if this keeps failing.'); return; }
    toast.success(p.discover_pinned ? 'Removed from Discover More priority.' : 'Pinned to top of Discover More.');
    await retryProducts();
  }

  async function updateStatus(id, status, order) {
    const { error, timedOut } = await safeQuery(supabase.from('orders').update({ status }).eq('id', id));
    if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
    if (timedOut) { toast.error('Timed out -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed: ' + error.message); return; }
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o));
    toast.success(`Status: ${status}`);
  }

  async function updateDelivery(id, date, order) {
    const { error, timedOut } = await safeQuery(supabase.from('orders').update({ estimated_delivery: date }).eq('id', id));
    if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
    if (timedOut) { toast.error('Timed out -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed: ' + error.message); return; }
    setOrders(prev => prev.map(o => o.id === id ? { ...o, estimated_delivery: date } : o));
    toast.success('Delivery date set.');
  }

  // A photo of the actual packed order -- api/send-order-whatsapp.js sends this
  // (in place of the product's generic catalog photo) when the chosen template
  // uses {{photo_url}}, which matters most for the Shipped/Delivered messages.
  async function updatePackageImage(id, url) {
    const { error, timedOut } = await safeQuery(supabase.from('orders').update({ package_image_url: url || null }).eq('id', id));
    if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
    if (timedOut) { toast.error('Timed out -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed: ' + error.message); return; }
    setOrders(prev => prev.map(o => o.id === id ? { ...o, package_image_url: url || null } : o));
    toast.success(url ? 'Package photo saved.' : 'Package photo removed.');
  }

  // Phase 5 -- shipping/tracking, entered once an order actually ships. Additive,
  // nullable columns: this .update() is written as if orders.shipping_carrier,
  // orders.tracking_number and orders.tracking_url already exist. If they don't
  // yet, Supabase returns a real column-does-not-exist error, surfaced as a normal
  // toast below rather than silently no-op'ing -- nothing here assumes the columns
  // are present.
  async function updateTracking(id, fields) {
    const { error, timedOut } = await safeQuery(supabase.from('orders').update(fields).eq('id', id));
    if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
    if (timedOut) { toast.error('Timed out -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed: ' + error.message + (error.message?.includes('column') ? ' -- the tracking columns may not exist on orders yet.' : '')); return; }
    setOrders(prev => prev.map(o => o.id === id ? { ...o, ...fields } : o));
    toast.success('Tracking info saved.');
  }

  // Fresh every call, same reasoning as EmailTestPanel's own copy above: this
  // must always reflect the current logged-in session, never a cached one.
  async function getAccessToken() {
    const { data, error } = await withTimeout(supabase.auth.getSession(), 8000);
    return (error || !data?.session?.access_token) ? null : data.session.access_token;
  }

  // Lazy + cached: only fetched the first time an admin actually opens a
  // notify picker, not on every Orders tab visit. null = not yet loaded.
  async function ensureOrderTemplates() {
    if (orderTemplates !== null) return orderTemplates;
    const { data, error, timedOut } = await safeQuery(
      supabase.from('email_templates').select('id, name, event_type, subject, enabled').eq('enabled', true).in('event_type', ORDER_EMAIL_EVENT_TYPES).order('event_type')
    );
    if (timedOut || error) {
      toast.error('Failed to load email templates: ' + (error?.message || 'timed out'));
      setOrderTemplates([]);
      return [];
    }
    const list = data || [];
    setOrderTemplates(list);
    return list;
  }

  async function ensureOrderWhatsAppTemplates() {
    if (orderWhatsAppTemplates !== null) return orderWhatsAppTemplates;
    const { data, error, timedOut } = await safeQuery(
      // FILE-4: order-shaped events only -- PRODUCT_ENQUIRY_RECEIVED resolves
      // against an enquiry, not an order, and would render blank tokens here.
      supabase.from('whatsapp_templates').select('id, name, event_type, enabled').eq('enabled', true).in('event_type', ORDER_WHATSAPP_EVENT_TYPES).order('event_type')
    );
    if (timedOut || error) {
      toast.error('Failed to load WhatsApp templates: ' + (error?.message || 'timed out'));
      setOrderWhatsAppTemplates([]);
      return [];
    }
    const list = data || [];
    setOrderWhatsAppTemplates(list);
    return list;
  }

  async function openNotify(order) {
    const [list, waList] = await Promise.all([ensureOrderTemplates(), ensureOrderWhatsAppTemplates()]);
    const suggested = SUGGESTED_EVENT_BY_STATUS[order.status];
    const match = suggested && list.find(t => t.event_type === suggested);
    setNotifyTemplateId(match ? match.id : (list[0]?.id || ''));
    const waSuggested = SUGGESTED_WA_EVENT_BY_STATUS[order.status];
    const waMatch = waSuggested && waList.find(t => t.event_type === waSuggested);
    setWaNotifyTemplateId(waMatch ? waMatch.id : (waList[0]?.id || ''));
    setNotifyOrderId(order.id);
  }

  async function sendOrderWhatsAppNotification(order) {
    if (!waNotifyTemplateId) { toast.error('Choose a WhatsApp template first.'); return; }
    setWaNotifySending(true);
    const token = await getAccessToken();
    if (!token) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); setWaNotifySending(false); return; }
    try {
      const res = await withTimeout(fetch('/api/send-order-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderId: order.id, templateId: waNotifyTemplateId }),
      }), 20000);
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || 'Failed to send WhatsApp message.');
      toast.success('WhatsApp message sent.');
    } catch (e) {
      toast.error(e.message || 'Failed to send WhatsApp message.');
    } finally {
      setWaNotifySending(false);
    }
  }

  async function sendOrderNotification(order) {
    if (!notifyTemplateId) { toast.error('Choose a template first.'); return; }
    setNotifySending(true);
    const token = await getAccessToken();
    if (!token) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); setNotifySending(false); return; }
    try {
      const res = await withTimeout(fetch('/api/send-order-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderId: order.id, templateId: notifyTemplateId }),
      }), 20000);
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || 'Failed to send email.');
      toast.success('Email sent to ' + order.user_email);
      // Deliberately doesn't close the panel -- it now also holds the
      // WhatsApp picker below, and sending one shouldn't hide the other
      // before the admin has a chance to use it too.
    } catch (e) {
      toast.error(e.message || 'Failed to send email.');
    } finally {
      setNotifySending(false);
    }
  }

  async function updateEnquiryStatus(id, status) {
    const { error, timedOut } = await safeQuery(supabase.from('enquiries').update({ status }).eq('id', id));
    if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
    if (timedOut) { toast.error('Timed out -- check your connection and try again.'); return; }
    if (error) { toast.error('Failed: ' + error.message); return; }
    setEnquiries(prev => prev.map(e => e.id === id ? { ...e, status } : e));
    toast.success(`Status: ${status}`);
  }

  // Phase 8 -- SOFT delete for orders, deliberately never a real DELETE. An
  // order is a financial/audit record tied to a real Razorpay payment_id and,
  // for a gift-card purchase, to an issued gift_cards row that carries this
  // order's order_id -- physically removing the row would orphan that link and
  // misrepresent real payment history (nothing here reverses the payment or
  // the gift card). Setting deleted_at instead keeps the row intact for
  // reconciliation while filteredOrders (below) hides it from the normal list.
  // Additive/nullable, same as the tracking fields above: written as if
  // orders.deleted_at already exists; the column-does-not-exist case surfaces
  // as a normal toast rather than a silent no-op.
  async function softDeleteOrder(id) {
    if (orderDeletingId) return; // double-click protection
    setOrderDeletingId(id);
    try {
      const { error, timedOut } = await safeQuery(supabase.from('orders').update({ deleted_at: new Date().toISOString() }).eq('id', id));
      if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
      if (timedOut) { toast.error('Timed out -- check your connection and try again.'); return; }
      if (error) { toast.error('Failed: ' + error.message + (error.message?.includes('column') ? ' -- the deleted_at column may not exist on orders yet.' : '')); return; }
      // Removed from view without a refetch -- filteredOrders already excludes
      // any row with deleted_at set, so this alone hides it immediately.
      setOrders(prev => prev.map(o => o.id === id ? { ...o, deleted_at: new Date().toISOString() } : o));
      setOrderDeleteConfirmId(null);
      toast.success('Order deleted.');
    } finally {
      setOrderDeletingId(null);
    }
  }

  // Phase 8 -- HARD delete for enquiries. Lower stakes than an order: no
  // payment or gift-card link, and the only other column that touches this
  // row (whatsapp_ack_sent) lives ON the enquiries row itself, not on some
  // other table with a foreign key into it -- nothing else in the codebase
  // references enquiries.id (confirmed by search), so removing the row
  // outright orphans nothing.
  async function deleteEnquiry(id) {
    if (enquiryDeletingId) return; // double-click protection
    setEnquiryDeletingId(id);
    try {
      const { error, timedOut } = await safeQuery(supabase.from('enquiries').delete().eq('id', id));
      if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/admin/login'); return; }
      if (timedOut) { toast.error('Timed out -- check your connection and try again.'); return; }
      if (error) { toast.error('Failed: ' + error.message); return; }
      setEnquiries(prev => prev.filter(e => e.id !== id));
      setEnquiryDeleteConfirmId(null);
      toast.success('Enquiry deleted.');
    } finally {
      setEnquiryDeletingId(null);
    }
  }

  const lbl = { fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  color: 'var(--adm-muted)',  display: 'block', marginBottom: 7 };
  const inp = { width: '100%', padding: '10px 12px', background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontSize: 14.5, outline: 'none', transition: 'border-color 0.25s' };
  // o.created_at is a UTC timestamp; the <input type="date"> filters below are
  // plain YYYY-MM-DD in the admin's own local calendar (IST, this business's
  // timezone) -- comparing them as bare strings with no conversion put an order
  // placed after ~6:30pm IST into "tomorrow" by UTC's clock, excluding it from a
  // same-day filter that should have included it. Converting each boundary to the
  // UTC instant IST midnight/23:59:59 actually corresponds to fixes that.
  const fromUTC = orderDateFrom ? new Date(orderDateFrom + 'T00:00:00+05:30').toISOString() : null;
  const toUTC = orderDateTo ? new Date(orderDateTo + 'T23:59:59+05:30').toISOString() : null;
  const ordersNeedingReviewCount = orders.filter(o => !o.deleted_at && o.inventory_issue).length;
  const filteredOrders = orders.filter(o => {
    // Phase 8: soft-deleted orders (deleted_at set) never show in the normal
    // list -- the row still exists in the database for reconciliation, but an
    // admin who didn't delete this order should never see it again. Simply
    // undefined (not just falsy) when the deleted_at column doesn't exist yet,
    // so this is a no-op filter until that migration is actually run.
    if (o.deleted_at) return false;
    if (orderStatusFilter !== 'All' && (o.status || 'Pending') !== orderStatusFilter) return false;
    if (orderNeedsReviewOnly && !o.inventory_issue) return false;
    if (fromUTC && (!o.created_at || o.created_at < fromUTC)) return false;
    if (toUTC && (!o.created_at || o.created_at > toUTC)) return false;
    if (orderSearch.trim()) {
      const q = orderSearch.trim().toLowerCase();
      const haystack = [o.order_id, o.id, o.user_name, o.user_email, o.user_phone].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  const ordersFiltered = orderStatusFilter !== 'All' || orderNeedsReviewOnly || orderDateFrom || orderDateTo || orderSearch.trim();

  const filteredProducts = products.filter(p => {
    if (productCatFilter !== 'All' && p.cat !== productCatFilter) return false;
    // isProductSoldOut, not raw p.stock -- a variant product's real availability
    // lives in its variants, and the base stock field goes stale/unused once
    // variants are added (same rule the storefront itself uses).
    if (productStockFilter === 'In Stock' && isProductSoldOut(p)) return false;
    if (productStockFilter === 'Sold Out' && !isProductSoldOut(p)) return false;
    if (productStockFilter === 'Low Stock' && !isLowStock(p)) return false;
    if (productVisibilityFilter === 'Live' && !p.available) return false;
    if (productVisibilityFilter === 'Hidden' && p.available) return false;
    if (productSearch.trim()) {
      const q = productSearch.trim().toLowerCase();
      if (!(p.name || '').toLowerCase().includes(q) && !(p.product_number || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const productsFiltered = productCatFilter !== 'All' || productStockFilter !== 'All' || productVisibilityFilter !== 'All' || productSearch.trim();
  // Client-side only, over the already-filtered/already-fetched list -- no
  // new query. Stock sorts by a variant product's lowest tracked stock so it
  // stays meaningful for both simple and variant products.
  if (productSort.key) {
    const getVal = {
      name: p => (p.name || '').toLowerCase(),
      price: p => Number(p.price) || 0,
      stock: p => {
        if (Array.isArray(p.variants) && p.variants.length > 0) {
          const known = p.variants.map(v => knownStock(v.stock)).filter(s => s !== null);
          return known.length ? Math.min(...known) : Infinity;
        }
        return knownStock(p.stock) ?? Infinity;
      },
    }[productSort.key];
    filteredProducts.sort((a, b) => (getVal(a) > getVal(b) ? 1 : getVal(a) < getVal(b) ? -1 : 0) * productSort.dir);
  }

  const filteredEnquiries = enquiries.filter(e => {
    if (enquiryStatusFilter !== 'All' && (e.status || 'Received') !== enquiryStatusFilter) return false;
    if (enquirySearch.trim()) {
      const q = enquirySearch.trim().toLowerCase();
      if (![e.product, e.user_name, e.user_email, e.user_phone].some(v => (v || '').toLowerCase().includes(q))) return false;
    }
    return true;
  });
  const enquiriesFiltered = enquiryStatusFilter !== 'All' || enquirySearch.trim();

  const ordersPendingCount = orders.filter(o => !o.deleted_at && (o.status || 'Pending') === 'Pending').length;
  const enquiriesNewCount = enquiries.filter(e => (e.status || 'Received') === 'Received').length;
  const [navOpen, setNavOpen] = useState(false);
  const [quickSearch, setQuickSearch] = useState('');
  // Presentation-only pagination over the already-loaded lists (no new queries; CSV export still uses the full filtered list).
  const [productPage, setProductPage] = useState(1);
  const [orderPage, setOrderPage] = useState(1);
  const PRODUCT_PAGE_SIZE = 25;
  const ORDER_PAGE_SIZE = 20;
  const productPages = Math.max(1, Math.ceil(filteredProducts.length / PRODUCT_PAGE_SIZE));
  const orderPages = Math.max(1, Math.ceil(filteredOrders.length / ORDER_PAGE_SIZE));
  const safeProductPage = Math.min(productPage, productPages);
  const safeOrderPage = Math.min(orderPage, orderPages);
  const pagedProducts = filteredProducts.slice((safeProductPage - 1) * PRODUCT_PAGE_SIZE, safeProductPage * PRODUCT_PAGE_SIZE);
  const pagedOrders = filteredOrders.slice((safeOrderPage - 1) * ORDER_PAGE_SIZE, safeOrderPage * ORDER_PAGE_SIZE);
  useEffect(() => { setProductPage(1); }, [productCatFilter, productStockFilter, productVisibilityFilter, productSearch, productSort.key, productSort.dir]);
  useEffect(() => { setOrderPage(1); }, [orderStatusFilter, orderDateFrom, orderDateTo, orderSearch, orderNeedsReviewOnly]);
  const navBadge = (i) => (i === 3 && ordersStatus !== 'loading' ? ordersPendingCount : i === 4 && enquiriesStatus !== 'loading' ? enquiriesNewCount : 0);
  // Same behaviour the old tab bar had: Tab 2 ("Add Product") is shared with Edit -- editProduct()
  // sets editId and jumps there too. Reaching it via this generic nav (rather than the Products
  // list's own "Add New Product" button, which already resets these) must clear any prior edit's
  // id/form, otherwise saving would silently overwrite whatever product was last edited.
  const goTab = (i) => {
    if (i === 2) { setForm({ ...EMPTY }); setEditId(null); loadedProductRef.current = null; }
    setTab(i);
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  };
  const adminName = (currentUser?.user_metadata?.full_name || currentUser?.email || 'Admin').split('@')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const recentOrders = orders.filter(o => !o.deleted_at).slice().sort((x, y) => new Date(y.created_at || 0) - new Date(x.created_at || 0)).slice(0, 6);
  const [pageTitle, pageSub] = TAB_META[tab] || ['', ''];

  return (
    <div className="adm">
      <div className="adm-shell">
        {/* SIDEBAR */}
        <aside className={`adm-sidebar${navOpen ? ' is-open' : ''}`} aria-label="Admin navigation">
          <div className="adm-brand">
            <img src={brandMark} alt="" />
            <div className="adm-brand-name">Bright<b>light</b></div>
            <span className="adm-brand-tag">Admin</span>
            <button type="button" className="adm-drawer-close" onClick={() => setNavOpen(false)} aria-label="Close menu"><NavIcon name="close" size={18} /></button>
          </div>
          <nav className="adm-nav">
            {TAB_NAV.map(g => (
              <div className="adm-nav-group" key={g.group}>
                <div className="adm-nav-label">{g.group}</div>
                {g.items.map(it => (
                  <button key={it.i} type="button" className={`adm-nav-item${tab === it.i ? ' is-active' : ''}`} onClick={() => goTab(it.i)} aria-current={tab === it.i ? 'page' : undefined}>
                    <NavIcon name={it.icon} />
                    <span>{it.label}</span>
                    {navBadge(it.i) > 0 && <span className="adm-nav-count">{navBadge(it.i)}</span>}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="adm-side-foot">
            <div className="adm-user">
              <div className="adm-avatar">{(adminName[0] || 'A').toUpperCase()}</div>
              <div className="adm-user-meta">
                <div className="adm-user-role">Signed in as admin</div>
                <div className="adm-user-email" title={currentUser?.email}>{currentUser?.email}</div>
              </div>
            </div>
          </div>
        </aside>
        <div className={`adm-scrim${navOpen ? ' is-open' : ''}`} onClick={() => setNavOpen(false)} aria-hidden="true" />

        <div className="adm-main">
          {/* TOP BAR */}
          <header className="adm-topbar">
            <button type="button" className="adm-menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu"><NavIcon name="menu" size={20} /></button>
            <form className="adm-search" role="search" onSubmit={e => { e.preventDefault(); setProductSearch(quickSearch.trim()); goTab(1); }}>
              <NavIcon name="search" size={17} />
              <input value={quickSearch} onChange={e => setQuickSearch(e.target.value)} placeholder="Search products by name or number" aria-label="Search products" />
            </form>
            <div className="adm-top-actions">
              <button type="button" className="adm-icon-btn" onClick={() => goTab(3)} title={ordersPendingCount > 0 ? `${ordersPendingCount} pending order${ordersPendingCount === 1 ? '' : 's'}` : 'Orders'} aria-label="Pending orders">
                <NavIcon name="bell" size={18} />
                {ordersPendingCount > 0 && <span className="adm-dot">{ordersPendingCount}</span>}
              </button>
              <button type="button" className="adm-btn adm-hide-sm" onClick={() => navigate('/')}><NavIcon name="store" size={16} /><span>View store</span></button>
              <button type="button" className="adm-btn primary" onClick={() => { logout(); navigate('/admin/login'); }}><NavIcon name="logout" size={16} /><span>Sign out</span></button>
            </div>
          </header>

          <div className="adm-content">
            <div className="adm-page-head">
              <h1 className="adm-page-title">{pageTitle}</h1>
              <p className="adm-page-sub">{pageSub}</p>
            </div>

        {/* DASHBOARD */}
        {tab === 0 && (
          <div>
            <div className="adm-welcome">
              <div>
                <h2>{greeting}, {adminName}</h2>
                <p>{ordersStatus === 'loading' ? 'Loading your store overview…' : ordersPendingCount > 0 ? `You have ${ordersPendingCount} pending order${ordersPendingCount === 1 ? '' : 's'} waiting for action.` : 'No pending orders right now — nicely done.'}</p>
              </div>
              <button type="button" className="adm-btn" onClick={() => goTab(2)}><NavIcon name="plus" size={16} /><span>Add product</span></button>
            </div>

            <div className="adm-kpis">
              <StatTile type="box" tone="primary" value={productsStatus === 'loading' ? '—' : products.length} error={productsStatus === 'error'} onRetry={retryProducts} label="Products" onClick={() => goTab(1)} />
              <StatTile type="orders" tone="info" value={ordersStatus === 'loading' ? '—' : orders.filter(o => !o.deleted_at).length} error={ordersStatus === 'error'} onRetry={retryOrders} label="Orders" onClick={() => goTab(3)} />
              <StatTile type="clock" tone="warning" value={ordersStatus === 'loading' ? '—' : ordersPendingCount} error={ordersStatus === 'error'} onRetry={retryOrders} label="Pending orders" onClick={() => { setOrderStatusFilter('Pending'); goTab(3); }} />
              <StatTile type="chat" tone="success" value={enquiriesStatus === 'loading' ? '—' : enquiriesNewCount} error={enquiriesStatus === 'error'} onRetry={retryEnquiries} label="New enquiries" onClick={() => goTab(4)} />
              <StatTile type="warning" tone="danger" value={productsStatus === 'loading' ? '—' : products.filter(isLowStock).length} error={productsStatus === 'error'} onRetry={retryProducts} label="Low stock" onClick={() => { setProductStockFilter('Low Stock'); goTab(1); }} />
            </div>

            <div className="adm-grid-2">
              <div className="adm-card adm-card-pad">
                <div className="adm-card-title">Orders — last 14 days</div>
                <div className="adm-card-sub" style={{ marginBottom: 14 }}>Daily order volume</div>
                {ordersStatus === 'error' ? (
                  <div className="adm-empty">
                    <div style={{ marginBottom: 10 }}>Unable to load order data.</div>
                    <button type="button" className="adm-btn" onClick={retryOrders}>Retry</button>
                  </div>
                ) : <OrdersTrendChart orders={orders} color={DASH_ACCENT} />}
              </div>
              <div className="adm-card adm-card-pad">
                <div className="adm-card-title">Orders by status</div>
                <div className="adm-card-sub" style={{ marginBottom: 14 }}>All-time breakdown</div>
                {ordersStatus === 'error' ? (
                  <div className="adm-empty">
                    <div style={{ marginBottom: 10 }}>Unable to load order data.</div>
                    <button type="button" className="adm-btn" onClick={retryOrders}>Retry</button>
                  </div>
                ) : <StatusBreakdownChart orders={orders} color={DASH_ACCENT} />}
              </div>
            </div>

            <div className="adm-actions">
              {[
                ['plus', 'Add a product', 'Create a new listing', () => goTab(2)],
                ['cart', 'Manage orders', 'Update status & tracking', () => goTab(3)],
                ['image', 'Edit banners', 'Refresh the home page', () => goTab(9)],
                ['tag', 'Create a coupon', 'Offer a discount code', () => goTab(6)],
              ].map(([icon, t, d, fn]) => (
                <button type="button" key={t} className="adm-action" onClick={fn}>
                  <span className="adm-action-ico"><NavIcon name={icon} size={19} /></span>
                  <span><div className="adm-action-t">{t}</div><div className="adm-action-d">{d}</div></span>
                </button>
              ))}
            </div>

            <div className="adm-card" style={{ overflow: 'hidden' }}>
              <div className="adm-card-pad" style={{ paddingBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div>
                  <div className="adm-card-title">Recent orders</div>
                  <div className="adm-card-sub">Your latest orders</div>
                </div>
                <button type="button" className="adm-btn" onClick={() => goTab(3)}>View all</button>
              </div>
              {ordersStatus === 'loading' ? (
                <div className="adm-card-pad" style={{ display: 'grid', gap: 10 }}>{[0, 1, 2].map(i => <div key={i} className="adm-skel" style={{ height: 18 }} />)}</div>
              ) : recentOrders.length === 0 ? (
                <div className="adm-empty">
                  <NavIcon name="cart" size={34} />
                  <div style={{ fontWeight: 600, color: 'var(--adm-ink)' }}>No orders yet</div>
                  <div style={{ fontSize: 13 }}>New orders will show up here as soon as customers check out.</div>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="adm-recent">
                    <thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Status</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                    <tbody>
                      {recentOrders.map(o => {
                        const st = statusPillStyle(o.status);
                        return (
                          <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => { setOrderSearch(o.order_id || o.user_email || ''); goTab(3); }}>
                            <td style={{ fontWeight: 700, color: 'var(--adm-ink)' }}>{o.order_id || String(o.id).slice(-8).toUpperCase()}</td>
                            <td>{o.user_name || '—'}</td>
                            <td style={{ color: 'var(--adm-muted)' }}>{o.created_at ? fmtDate(o.created_at) : '—'}</td>
                            <td><span className="adm-pill" style={{ background: st.bg, color: st.fg }}>{o.status || 'Pending'}</span></td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--adm-ink)' }}>{fmt(o.total)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* PRODUCTS LIST */}
        {tab === 1 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
              <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  color: 'var(--gd)' }}>All Products ({filteredProducts.length}{productsFiltered ? ` of ${products.length}` : ''})</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => downloadCsv('products.csv',
                  [
                    { label: 'Product Number', get: p => p.product_number },
                    { label: 'Name', get: p => p.name },
                    { label: 'Category', get: p => p.cat },
                    { label: 'Price', get: p => p.price },
                    { label: 'Shipping Charge', get: p => p.shipping_charge },
                    { label: 'Stock', get: p => (p.variants || []).length > 0 ? 'Variants' : p.stock },
                    { label: 'Available', get: p => p.available ? 'Yes' : 'No' },
                    { label: 'Featured', get: p => p.featured ? 'Yes' : 'No' },
                  ], filteredProducts)} style={{ background: 'none', border: '1px solid var(--adm-border-strong)', color: 'var(--adm-muted)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '8px 14px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Export CSV</button>
                <button onClick={() => { setForm({ ...EMPTY }); setEditId(null); loadedProductRef.current = null; setTab(2); }} style={{ background: 'var(--gd)', border: 'none', color: 'var(--text-dark)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '9px 18px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Add New Product</button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20, padding: '16px 18px', background: '#FFFFFF', border: '1px solid var(--adm-border)', borderRadius: 8 }}>
              <div>
                <label style={{ ...lbl, marginBottom: 6 }}>Category</label>
                <select value={productCatFilter} onChange={e => setProductCatFilter(e.target.value)} style={{ background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', padding: '8px 12px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  outline: 'none', cursor: 'pointer' }}>
                  <option value="All">All Categories</option>
                  {liveCats.map(c => <option key={c} value={c} style={{ background: '#fff' }}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label style={{ ...lbl, marginBottom: 6 }}>Stock</label>
                <select value={productStockFilter} onChange={e => setProductStockFilter(e.target.value)} style={{ background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', padding: '8px 12px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  outline: 'none', cursor: 'pointer' }}>
                  <option value="All">All Stock</option>
                  <option value="In Stock">In Stock</option>
                  <option value="Low Stock">Low Stock</option>
                  <option value="Sold Out">Sold Out</option>
                </select>
              </div>
              <div>
                <label style={{ ...lbl, marginBottom: 6 }}>Visibility</label>
                <select value={productVisibilityFilter} onChange={e => setProductVisibilityFilter(e.target.value)} style={{ background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', padding: '8px 12px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  outline: 'none', cursor: 'pointer' }}>
                  <option value="All">All</option>
                  <option value="Live">Live</option>
                  <option value="Hidden">Hidden</option>
                </select>
              </div>
              <div>
                <label style={{ ...lbl, marginBottom: 6 }}>Search</label>
                <input value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="Name or number..." style={{ background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', padding: '8px 12px', fontFamily: 'var(--font-body)', fontSize: 15, outline: 'none', width: 220 }} />
              </div>
              {productsFiltered && (
                <button onClick={() => { setProductCatFilter('All'); setProductStockFilter('All'); setProductVisibilityFilter('All'); setProductSearch(''); }} style={{ background: 'none', border: '1px solid var(--adm-border-strong)', color: 'var(--adm-body)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '8px 14px', cursor: 'pointer' }}>Clear</button>
              )}
            </div>
            {productsStatus === 'loading' ? <AdminSkeleton /> : productsStatus === 'error' ? (
              <div style={{ textAlign: 'center', padding: 60 }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 17, color: 'var(--error)', marginBottom: 14 }}>Unable to load products.</div>
                <button onClick={retryProducts} style={{ background: 'none', border: '1px solid var(--adm-border-strong)', color: 'var(--gd)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  padding: '9px 18px', cursor: 'pointer' }}>Retry</button>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                  <thead><tr>{['Image', '#', 'Name', 'Category', 'Price', 'Shipping', 'Total', 'Stock', 'Visible', 'Actions'].map(h => {
                    const sortKey = { Name: 'name', Price: 'price', Stock: 'stock' }[h];
                    const thStyle = { fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  padding: '10px 12px', textAlign: 'left', borderBottom: '1px solid var(--adm-border)', color: 'var(--adm-muted)' };
                    if (!sortKey) return <th key={h} style={thStyle}>{h}</th>;
                    const active = productSort.key === sortKey;
                    return (
                      <th key={h} style={{ ...thStyle, cursor: 'pointer', userSelect: 'none', color: active ? 'var(--gd)' : thStyle.color }}
                        onClick={() => setProductSort(s => ({ key: sortKey, dir: s.key === sortKey ? -s.dir : 1 }))}>
                        {h}{active ? (productSort.dir === 1 ? ' ▲' : ' ▼') : ''}
                      </th>
                    );
                  })}</tr></thead>
                  <tbody>
                    {pagedProducts.map(p => (
                      <tr key={p.id}>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--adm-border)' }}><div style={{ width: 52, height: 52, background: p.bg, overflow: 'hidden' }}>{p.images?.[0] && <img src={thumb(p.images[0], 110)} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</div></td>
                        <td style={{ padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--adm-muted)', borderBottom: '1px solid var(--adm-border)', whiteSpace: 'nowrap' }}>{p.product_number || '—'}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--iv)', fontSize: 16, borderBottom: '1px solid var(--adm-border)' }}>{p.name}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--adm-border)' }}><span className="adm-chip">{p.cat}</span></td>
                        <td style={{ padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 17, color: 'var(--iv)', fontWeight: 500, borderBottom: '1px solid var(--adm-border)' }}>{p.enquiry_only ? <span style={{ fontStyle: 'normal', fontSize: 16, color: 'var(--adm-muted)' }}>Enquiry</span> : fmt(p.price)}</td>
                        <td style={{ padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 17, color: 'var(--adm-muted)', borderBottom: '1px solid var(--adm-border)' }}>{p.shipping_charge ? fmt(p.shipping_charge) : '—'}</td>
                        <td style={{ padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 17, color: 'var(--iv)', fontWeight: 500, borderBottom: '1px solid var(--adm-border)' }}>{p.enquiry_only ? '—' : fmt(effectivePrice(p.price, p.shipping_charge))}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--adm-border)' }}>{isProductSoldOut(p) ? <span className="adm-badge neutral">Sold out</span> : (p.variants || []).length > 0 ? <span style={{ color: 'var(--adm-muted)', fontSize: 14, fontStyle: 'normal' }}>Variants</span> : p.stock === 1 ? <span className="adm-badge danger">Last 1</span> : isLowStock(p) ? <span className="adm-badge warning">Low stock ({p.stock})</span> : <span style={{ color: 'var(--adm-muted)', fontSize: 15 }}>{p.stock}</span>}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--adm-border)' }}><span className={`adm-badge ${p.available ? 'success' : 'neutral'}`}>{p.available ? 'Live' : 'Hidden'}</span></td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--adm-border)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, max-content)', gap: 6 }}>
                            <button onClick={() => toggleFeatured(p)} title={p.featured ? 'Unpin from Featured Products' : 'Pin to Featured Products'} style={{ background: p.featured ? 'var(--gd)' : 'none', border: '1px solid var(--adm-border-strong)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  color: p.featured ? 'var(--text-dark)' : 'var(--gd)', padding: '5px 10px', cursor: 'pointer',  display: 'inline-flex', alignItems: 'center', gap: 6 }}><AdminIcon name="star" size={12} filled={p.featured} /> Featured</button>
                            <button onClick={() => toggleDiscoverPin(p)} title={p.discover_pinned ? 'Remove from top of Discover More' : 'Pin to top of Discover More'} style={{ background: p.discover_pinned ? 'var(--gd)' : 'none', border: '1px solid var(--adm-border-strong)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  color: p.discover_pinned ? 'var(--text-dark)' : 'var(--gd)', padding: '5px 10px', cursor: 'pointer',  display: 'inline-flex', alignItems: 'center', gap: 6 }}><AdminIcon name="triangleUp" size={11} filled={p.discover_pinned} /> Discover</button>
                            <button onClick={() => editProduct(p)} style={{ background: 'none', border: '1px solid var(--adm-border-strong)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  color: 'var(--gd)', padding: '5px 10px', cursor: 'pointer' }} onMouseEnter={e => e.target.style.background = 'var(--adm-fill-2)'} onMouseLeave={e => e.target.style.background = 'none'}>Edit</button>
                            <button onClick={() => deleteProduct(p)} style={{ background: 'none', border: '1px solid rgba(192,53,43,.4)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  color: 'var(--error)', padding: '5px 10px', cursor: 'pointer' }} onMouseEnter={e => e.target.style.background = 'rgba(192,53,43,.1)'} onMouseLeave={e => e.target.style.background = 'none'}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredProducts.length === 0 && <tr><td colSpan={10}><AdminEmpty icon="box" title={productsFiltered ? 'No products match your filters' : 'No products yet'} hint={productsFiltered ? 'Try clearing a filter or searching for something else.' : 'Add your first product to start selling.'} /></td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            <AdminPager page={safeProductPage} pages={productPages} total={filteredProducts.length} pageSize={PRODUCT_PAGE_SIZE} onPage={setProductPage} />
          </div>
        )}

        {/* ADD/EDIT PRODUCT */}
        {tab === 2 && (
          <div style={{ maxWidth: 980 }}>
            <div className="adm-badge primary" style={{ marginBottom: 16 }}>{editId ? 'Editing product' : 'New product'}</div>
            <div style={{ background: '#fff', border: '1px solid var(--adm-border)', borderRadius: 14, boxShadow: '0 1px 2px rgba(21,24,38,.04)', padding: '28px 28px' }}>
              <div className="admin-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div style={{ gridColumn: '1/-1' }}><label style={lbl}>Product Name *</label><input style={inp} value={form.name} onChange={e => setF('name', e.target.value)} placeholder="e.g. Cotton Kurta Set - Blue" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
                <div><label style={lbl}>Product Number (Admin reference only)</label><input style={inp} value={form.product_number} onChange={e => setF('product_number', e.target.value)} placeholder="e.g. BL-042" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
                <div><label style={lbl}>Subtitle</label><input style={inp} value={form.subtitle} onChange={e => setF('subtitle', e.target.value)} placeholder="e.g. Soft cotton, comfortable fit" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
                <div><label style={lbl}>Category</label><select style={{ ...inp, cursor: 'pointer' }} value={form.cat} onChange={e => setF('cat', e.target.value)}>{liveCats.map(c => <option key={c} value={c} style={{ background: '#fff' }}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}</select></div>
                <div style={{ gridColumn: '1/-1' }}><label style={lbl}>Brand / Make</label><input style={inp} value={form.origin} onChange={e => setF('origin', e.target.value)} placeholder="e.g. Brand name" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
                <div><label style={lbl}>Specification</label><input style={inp} value={form.material} onChange={e => setF('material', e.target.value)} placeholder="e.g. Windows / Cloud" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
                <div><label style={lbl}>Dimensions</label><input style={inp} value={form.dimensions} onChange={e => setF('dimensions', e.target.value)} placeholder='10" H x 4" W' onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
                <div><label style={lbl}>Weight</label><input style={inp} value={form.weight} onChange={e => setF('weight', e.target.value)} placeholder="e.g. 1.2 kg" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
                <div><label style={lbl}>Stock (0 = Sold Out)</label><input style={inp} type="number" min="0" value={form.stock} onChange={e => setF('stock', e.target.value)} onWheel={e => e.currentTarget.blur()} onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
                <div><label style={lbl}>Delivery — Min Days</label><input style={inp} type="number" min="0" value={form.delivery_min_days} onChange={e => setF('delivery_min_days', e.target.value)} onWheel={e => e.currentTarget.blur()} placeholder="e.g. 5" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
                <div><label style={lbl}>Delivery — Max Days</label><input style={inp} type="number" min="0" value={form.delivery_max_days} onChange={e => setF('delivery_max_days', e.target.value)} onWheel={e => e.currentTarget.blur()} placeholder="e.g. 8" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
                <div><label style={lbl}>Fulfillment</label><select style={inp} value={form.fulfillment_type} onChange={e => setF('fulfillment_type', e.target.value)} onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'}><option value="ready_to_ship">Ready to Ship</option><option value="made_to_order">Made to Order</option></select></div>
                <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="checkbox" id="eq" checked={form.enquiry_only} onChange={e => setF('enquiry_only', e.target.checked)} style={{ accentColor: 'var(--gd)', width: 16, height: 16, cursor: 'pointer' }} />
                  <label htmlFor="eq" style={{ ...lbl, marginBottom: 0, cursor: 'pointer' }}>Enquiry Only (hide price, show WhatsApp button)</label>
                </div>
                {!form.enquiry_only && <div><label style={lbl}>Price (₹)</label><input style={inp} type="number" value={form.price} onChange={e => setF('price', e.target.value)} onWheel={e => e.currentTarget.blur()} placeholder="e.g. 4500" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>}
                {!form.enquiry_only && (
                  <div>
                    <label style={lbl}>Shipping Charge (₹, optional)</label>
                    <input style={inp} type="number" value={form.shipping_charge} onChange={e => setF('shipping_charge', e.target.value)} onWheel={e => e.currentTarget.blur()} placeholder="e.g. 100" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} />
                  </div>
                )}
                {!form.enquiry_only && !!Number(form.shipping_charge) && (
                  <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="checkbox" id="ssc" checked={form.show_shipping_at_checkout} onChange={e => setF('show_shipping_at_checkout', e.target.checked)} style={{ accentColor: 'var(--gd)', width: 16, height: 16, cursor: 'pointer' }} />
                    <label htmlFor="ssc" style={{ ...lbl, marginBottom: 0, cursor: 'pointer' }}>Itemize shipping as its own line at checkout (unchecked = folded silently into the price; the total charged is the same either way)</label>
                  </div>
                )}
                {!form.enquiry_only && !!Number(form.shipping_charge) && (
                  <div style={{ gridColumn: '1/-1', fontFamily: 'var(--font-body)', fontSize: 14.5, fontStyle: 'normal', color: 'var(--adm-muted)', marginTop: -8 }}>
                    Customers will see {fmt((Number(form.price) || 0) + Number(form.shipping_charge))} as the price (product + shipping combined) everywhere, including at checkout.
                  </div>
                )}
                <div><label style={lbl}>Badge 1</label><input style={inp} value={form.badge} onChange={e => setF('badge', e.target.value)} placeholder="Featured / New / Best Seller" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
                <div><label style={lbl}>Badge 2 (optional)</label><input style={inp} value={form.badge2} onChange={e => setF('badge2', e.target.value)} placeholder="e.g. Top Pick" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
                <div style={{ gridColumn: '1/-1' }}><label style={lbl}>Pinterest Pin URL (optional)</label><input style={inp} value={form.pinterest_url} onChange={e => setF('pinterest_url', e.target.value)} placeholder="Paste the pin's URL from Pinterest — leave blank to auto-generate a Pin It link" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>

                {/* VARIANTS */}
                <div style={{ gridColumn: '1/-1', borderTop: '1px dashed var(--adm-border-strong)', paddingTop: 18, marginTop: 4 }}>
                  <label style={lbl}>Variants (optional)</label>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 14.5, fontStyle: 'normal', color: 'var(--adm-muted)', marginBottom: 14 }}>
                    Use this if the product comes in more than one option — actual sizes like Small / Medium / Large, or distinct named editions sold under one listing (e.g. "Standard" and "Pro") — each with its own price, weight, dimensions and stock. Customers pick one on the product page and see that option's details, pre-selected to the first available by default. Leave empty for a single-option product (the Price/Weight/Dimensions/Stock fields above are used instead).
                  </div>
                  {(form.variants || []).map((v, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <input style={{ ...inp, flex: '1 1 110px' }} value={v.size} onChange={e => updateVariant(i, 'size', e.target.value)} placeholder="Option name (Small, or Pro)" />
                      <input style={{ ...inp, flex: '1 1 100px' }} type="number" value={v.price} onChange={e => updateVariant(i, 'price', e.target.value)} onWheel={e => e.currentTarget.blur()} placeholder="Price (₹)" />
                      <input style={{ ...inp, flex: '1 1 90px' }} value={v.weight} onChange={e => updateVariant(i, 'weight', e.target.value)} placeholder="Weight" />
                      <input style={{ ...inp, flex: '1 1 120px' }} value={v.dimensions} onChange={e => updateVariant(i, 'dimensions', e.target.value)} placeholder="Dimensions" />
                      <input style={{ ...inp, flex: '0 1 80px' }} type="number" min="0" value={v.stock} onChange={e => updateVariant(i, 'stock', e.target.value)} onWheel={e => e.currentTarget.blur()} placeholder="Stock" />
                      <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                        <button type="button" onClick={() => moveVariant(i, -1)} disabled={i === 0} title="Move up" style={{ background: 'none', border: '1px solid var(--adm-border-strong)', borderBottom: 'none', color: 'var(--gd)', width: 24, height: 17, cursor: i === 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: i === 0 ? 0.3 : 1 }}><AdminIcon name="chevronUp" size={10} /></button>
                        <button type="button" onClick={() => moveVariant(i, 1)} disabled={i === (form.variants || []).length - 1} title="Move down" style={{ background: 'none', border: '1px solid var(--adm-border-strong)', color: 'var(--gd)', width: 24, height: 17, cursor: i === (form.variants || []).length - 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: i === (form.variants || []).length - 1 ? 0.3 : 1 }}><AdminIcon name="chevronDown" size={10} /></button>
                      </div>
                      <button type="button" onClick={() => removeVariant(i)} title="Remove size" style={{ background: 'none', border: '1px solid rgba(192,53,43,.4)', color: 'var(--error)', width: 34, height: 34, flexShrink: 0, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
                    </div>
                  ))}
                  <button type="button" onClick={addVariant} style={{ background: 'none', border: '1px dashed var(--adm-border-strong)', color: 'var(--gd)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '9px 16px', cursor: 'pointer', marginTop: 4 }}>+ Add Option</button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="checkbox" id="av" checked={form.available} onChange={e => setF('available', e.target.checked)} style={{ accentColor: 'var(--gd)', width: 16, height: 16, cursor: 'pointer' }} />
                  <label htmlFor="av" style={{ ...lbl, marginBottom: 0, cursor: 'pointer' }}>Visible on website</label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="checkbox" id="ft" checked={form.featured} onChange={e => setF('featured', e.target.checked)} style={{ accentColor: 'var(--gd)', width: 16, height: 16, cursor: 'pointer' }} />
                  <label htmlFor="ft" style={{ ...lbl, marginBottom: 0, cursor: 'pointer' }}>Featured (pin to Homepage showcase)</label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="checkbox" id="cp" checked={form.is_collectors_piece} onChange={e => setF('is_collectors_piece', e.target.checked)} style={{ accentColor: 'var(--gd)', width: 16, height: 16, cursor: 'pointer' }} />
                  <label htmlFor="cp" style={{ ...lbl, marginBottom: 0, cursor: 'pointer' }}>Top Pick (shows a badge, included in the Top Picks collection)</label>
                </div>
                <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="checkbox" id="aq" checked={form.allow_enquiry} onChange={e => setF('allow_enquiry', e.target.checked)} style={{ accentColor: 'var(--gd)', width: 16, height: 16, cursor: 'pointer' }} />
                  <label htmlFor="aq" style={{ ...lbl, marginBottom: 0, cursor: 'pointer' }}>Allow WhatsApp Enquiry (uncheck for fixed-price / non-negotiable items)</label>
                </div>
                <div style={{ gridColumn: '1/-1' }}><label style={lbl}>Description</label><textarea style={{ ...inp, resize: 'vertical', lineHeight: 1.7 }} rows={4} value={form.story} onChange={e => setF('story', e.target.value)} placeholder="What this product does and who it is for..." onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
                <div style={{ gridColumn: '1/-1' }}><label style={lbl}>Related Products Note</label><textarea style={{ ...inp, resize: 'vertical', lineHeight: 1.7 }} rows={3} value={form.together} onChange={e => setF('together', e.target.value)} placeholder="e.g. Pairs well with the matching accessories below" onFocus={e => e.target.style.borderColor = 'var(--gd)'} onBlur={e => e.target.style.borderColor = 'var(--adm-border-strong)'} /></div>
                <div style={{ gridColumn: '1/-1' }}>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 14.5, fontStyle: 'normal', color: 'var(--adm-muted)', marginBottom: 8 }}>Best results at 1080 &times; 1350px (a 4:5 portrait) &mdash; matches the crop used on the Shop grid and product page.</div>
                  <ImageUploader
                    key={editId || 'new'}
                    images={form.images || []}
                    onChange={imgs => setF('images', imgs)}
                    video={form.video_url ? { videoUrl: form.video_url, videoPosition: form.video_position, onVideoPositionChange: v => setF('video_position', v) } : null}
                  />
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <ImagePositionPicker image={form.images?.[0]} value={form.image_position} onChange={v => setF('image_position', v)} aspect="4/5" width={280} />
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={lbl}>Product Video (optional)</label>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 14.5, fontStyle: 'normal', color: 'var(--adm-muted)', marginBottom: 8 }}>Set its position among the photos using the ← → arrows on its tile above. Most products won't need one.</div>
                  {form.video_url && <video src={form.video_url} controls style={{ width: '100%', maxWidth: 280, display: 'block', marginBottom: 8, background: '#000', border: '1px solid var(--adm-border)' }} />}
                  <MediaUrlField
                    value={form.video_url}
                    onChange={v => setF('video_url', v)}
                    onSave={v => setF('video_url', v)}
                    placeholder="Paste a video URL..."
                    accept="video/*"
                    inputStyle={inp}
                    folder="products"
                  />
                  {form.video_url && (
                    <div style={{ marginTop: 16 }}>
                      <label style={lbl}>Video Cover Image (optional)</label>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 14.5, fontStyle: 'normal', color: 'var(--adm-muted)', marginBottom: 8 }}>Shown first on this product's tile in the Shop and on the homepage, with a play badge. Without one, the tile keeps showing the first photo. The product page always opens on the video.</div>
                      <MediaUrlField
                        value={form.video_cover_url || ''}
                        onChange={v => setF('video_cover_url', v)}
                        onSave={v => setF('video_cover_url', v)}
                        placeholder="Paste an image URL..."
                        accept="image/*"
                        inputStyle={inp}
                        folder="products"
                      />
                      {form.video_cover_url && (
                        <div style={{ marginTop: 12 }}>
                          <ImagePositionPicker image={form.video_cover_url} value={form.video_cover_position || '50% 50%'} onChange={v => setF('video_cover_position', v)} aspect="4/5" width={280} />
                          <button onClick={() => { setF('video_cover_url', ''); setF('video_cover_position', ''); }} style={{ marginTop: 8, background: 'none', border: '1px solid rgba(192,53,43,.4)', color: 'var(--error)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5,  padding: '5px 12px', cursor: 'pointer' }}>Remove Cover</button>
                        </div>
                      )}
                    </div>
                  )}
                  {form.video_url && <button onClick={() => setF('video_url', '')} style={{ marginTop: 8, background: 'none', border: '1px solid rgba(192,53,43,.4)', color: 'var(--error)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5,  padding: '5px 12px', cursor: 'pointer', alignSelf: 'flex-start' }}>Remove Video</button>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 28, position: 'sticky', bottom: 0, background: '#fff', margin: '28px -28px -28px', padding: '16px 28px', borderTop: '1px solid var(--adm-border)', borderRadius: '0 0 14px 14px', zIndex: 5 }}>
                <button onClick={saveProduct} disabled={saving} style={{ background: 'var(--gd)', border: 'none', color: 'var(--text-dark)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '13px 28px', cursor: 'pointer', opacity: saving ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 10 }}>
                  {saving ? <span style={{ width: 14, height: 14, border: '2px solid var(--adm-border-strong)', borderTopColor: 'var(--br)', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} /> : null}
                  {editId ? 'Update Product' : 'Add Product'}
                </button>
                {editId && <button onClick={() => { setForm({ ...EMPTY }); setEditId(null); loadedProductRef.current = null; setTab(1); }} style={{ background: 'transparent', border: '1px solid var(--adm-border-strong)', color: 'var(--adm-muted)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  padding: '13px 28px', cursor: 'pointer' }}>Cancel</button>}
              </div>
            </div>
          </div>
        )}

        {/* ORDERS */}
        {tab === 3 && (
          <div>
            <h2 style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  color: 'var(--gd)', marginBottom: 20 }}>All Orders ({orders.filter(o => !o.deleted_at).length})</h2>

            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20, padding: '16px 18px', background: '#FFFFFF', border: '1px solid var(--adm-border)', borderRadius: 8 }}>
              <div>
                <label style={{ ...lbl, marginBottom: 6 }}>Status</label>
                <select value={orderStatusFilter} onChange={e => setOrderStatusFilter(e.target.value)} style={{ background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', padding: '8px 12px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  outline: 'none', cursor: 'pointer' }}>
                  <option value="All">All Statuses</option>
                  {STATUSES.map(s => <option key={s} value={s} style={{ background: '#fff' }}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={{ ...lbl, marginBottom: 6 }}>From</label>
                <input type="date" value={orderDateFrom} onChange={e => setOrderDateFrom(e.target.value)} style={{ background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', padding: '8px 12px', fontFamily: 'var(--font-body)', fontSize: 15, outline: 'none', colorScheme: 'light' }} />
              </div>
              <div>
                <label style={{ ...lbl, marginBottom: 6 }}>To</label>
                <input type="date" value={orderDateTo} onChange={e => setOrderDateTo(e.target.value)} style={{ background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', padding: '8px 12px', fontFamily: 'var(--font-body)', fontSize: 15, outline: 'none', colorScheme: 'light' }} />
              </div>
              <div>
                <label style={{ ...lbl, marginBottom: 6 }}>Search</label>
                <input value={orderSearch} onChange={e => setOrderSearch(e.target.value)} placeholder="Name, email, phone, order ID..." style={{ background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', padding: '8px 12px', fontFamily: 'var(--font-body)', fontSize: 15, outline: 'none', width: 220 }} />
              </div>
              {/* FLOW-7 quick filter -- isolates orders whose stock reservation didn't
                  survive to payment (see the badge on each order card below). */}
              <button
                onClick={() => setOrderNeedsReviewOnly(v => !v)}
                aria-pressed={orderNeedsReviewOnly}
                style={{
                  background: orderNeedsReviewOnly ? 'var(--error)' : 'none',
                  border: `1px solid ${orderNeedsReviewOnly ? 'var(--error)' : 'rgba(192,53,43,.4)'}`,
                  color: orderNeedsReviewOnly ? '#fff' : 'var(--error)',
                  fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12, 
                  padding: '8px 14px', cursor: 'pointer', minHeight: 38,
                }}
              >Needs Review{ordersNeedingReviewCount > 0 ? ` (${ordersNeedingReviewCount})` : ''}</button>
              {ordersFiltered && (
                <button onClick={() => { setOrderStatusFilter('All'); setOrderNeedsReviewOnly(false); setOrderDateFrom(''); setOrderDateTo(''); setOrderSearch(''); }} style={{ background: 'none', border: '1px solid var(--adm-border-strong)', color: 'var(--adm-body)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '8px 14px', cursor: 'pointer' }}>Clear</button>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--adm-body)', fontStyle: 'normal' }}>
                  Showing {filteredOrders.length} of {orders.filter(o => !o.deleted_at).length}
                </div>
                <button onClick={() => downloadCsv('orders.csv',
                  [
                    { label: 'Order ID', get: o => o.order_id || o.id },
                    { label: 'Status', get: o => o.status || 'Pending' },
                    { label: 'Customer Name', get: o => o.user_name },
                    { label: 'Email', get: o => o.user_email },
                    { label: 'Phone', get: o => o.user_phone },
                    { label: 'Total', get: o => o.total },
                    { label: 'Coupon', get: o => o.coupon_code },
                    { label: 'Discount', get: o => o.discount },
                    { label: 'Payment Method', get: o => o.payment_method },
                    { label: 'Payment ID', get: o => o.payment_id },
                    { label: 'Created At', get: o => o.created_at },
                  ], filteredOrders)} style={{ background: 'none', border: '1px solid var(--adm-border-strong)', color: 'var(--adm-muted)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '8px 14px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Export CSV</button>
              </div>
            </div>

            {ordersStatus === 'loading' ? <AdminSkeleton /> : ordersStatus === 'error' ? (
              <div style={{ textAlign: 'center', padding: 60 }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 17, color: 'var(--error)', marginBottom: 14 }}>Unable to load orders.</div>
                <button onClick={retryOrders} style={{ background: 'none', border: '1px solid var(--adm-border-strong)', color: 'var(--gd)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  padding: '9px 18px', cursor: 'pointer' }}>Retry</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {pagedOrders.map(o => (
                  <div key={o.id} style={{ background: 'var(--adm-fill)', border: '1px solid var(--adm-border)', borderRadius: 10, padding: '22px 24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 15,  color: 'var(--gd)', overflowWrap: 'anywhere' }}>{o.order_id || o.id.slice(-8).toUpperCase()}</div>
                          <span className="adm-pill" style={{ background: statusPillStyle(o.status).bg, color: statusPillStyle(o.status).fg }}>{o.status || 'Pending'}</span>
                          {/* FLOW-7: a paid order whose stock reservation had already expired or
                              gone missing when it was finalized (see orderWrite.js) -- money moved,
                              but the automatic stock decrement may not have happened. Needs a human
                              to check inventory, so it can't just sit invisible next to a normal order. */}
                          {o.inventory_issue && (
                            <span title={o.inventory_issue.reason} className="adm-pill" style={{ background: '#FDE9E7', color: '#C0352B' }}>
                              Needs Review — {o.inventory_issue.reason}
                            </span>
                          )}
                        </div>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: 16, color: 'var(--adm-body)', marginTop: 3, overflowWrap: 'anywhere' }}>{o.user_name}, {o.user_email}</div>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: 16, color: 'var(--adm-body)', marginTop: 2 }}>{o.user_phone} | {o.created_at ? fmtDate(o.created_at) : '-'}</div>
                        {o.user_email && (
                          <button onClick={() => { setOrderStatusFilter('All'); setOrderDateFrom(''); setOrderDateTo(''); setOrderSearch(o.user_email); window.scrollTo({ top: 0, behavior: 'smooth' }); }} style={{ background: 'none', border: 'none', padding: 0, marginTop: 4, fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11.5,  color: 'var(--gd)', textDecoration: 'underline', cursor: 'pointer' }}>View this customer's other orders</button>
                        )}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: 22, color: 'var(--iv)', fontWeight: 500 }}>{fmt(o.total)}</div>
                        {o.coupon_code && <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11.5,  color: 'var(--success)', marginTop: 2 }}>{o.coupon_code} (-{fmt(o.discount || 0)})</div>}
                        <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13, color: o.payment_method === 'razorpay' ? 'var(--success)' : 'var(--gd)',  marginTop: 4 }}>{o.payment_method === 'razorpay' ? 'Online' : 'WhatsApp/COD'}</div>
                        {o.payment_id && <div style={{ fontFamily: 'var(--font-body)', fontWeight: 500, fontSize: 10.5, color: 'var(--adm-body)', marginTop: 2, overflowWrap: 'anywhere' }}>Pay ID: {o.payment_id}</div>}
                      </div>
                    </div>
                    <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--adm-border)' }}>
                      {o.items?.map((item, i) => (
                        <div key={i} style={{ display: 'inline-block', marginRight: 12 }}>
                          <span style={{ fontFamily: 'var(--font-body)', fontSize: 16, color: 'var(--adm-body)' }}>{item.name}{item.size ? ` — ${item.size}` : ''} ×{item.qty}</span>
                          {item.isGiftCard && (
                            <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11,  color: 'var(--gd)', background: 'var(--adm-fill-2)', padding: '2px 8px', marginLeft: 6 }}>
                              {item.giftCode}{item.recipientName ? ` → ${item.recipientName} (${item.recipientEmail})` : ''}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    {o.address && <div style={{ marginBottom: 14, fontFamily: 'var(--font-body)', fontSize: 16, color: 'var(--adm-body)', lineHeight: 1.6 }}>{o.address.line1}{o.address.line2 ? ', ' + o.address.line2 : ''}, {o.address.city}, {o.address.state}, {o.address.pincode}</div>}
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ ...lbl, marginBottom: 6 }}>Package Photo</label>
                      <PackagePhotoField order={o} onSave={updatePackageImage} />
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ ...lbl, marginBottom: 6 }}>Shipping / Tracking</label>
                      <TrackingFields order={o} onSave={updateTracking} />
                    </div>
                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <div>
                        <label style={{ ...lbl, marginBottom: 6 }}>Status</label>
                        <select value={o.status || 'Pending'} onChange={e => updateStatus(o.id, e.target.value, o)} style={{ background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', padding: '8px 12px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  outline: 'none', cursor: 'pointer' }}>
                          {STATUSES.map(s => <option key={s} value={s} style={{ background: '#fff' }}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ ...lbl, marginBottom: 6 }}>Delivery Date</label>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <input type="date" id={`dd-${o.id}`} defaultValue={toDateInputValue(o.estimated_delivery)} style={{ background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', padding: '8px 12px', fontFamily: 'var(--font-body)', fontSize: 16, outline: 'none', colorScheme: 'light' }} />
                          <button onClick={() => {
                            const v = document.getElementById(`dd-${o.id}`)?.value;
                            // Store the plain YYYY-MM-DD the date input gave us directly, rather
                            // than round-tripping it through new Date(v).toLocaleDateString() --
                            // that conversion (UTC-parsed bare date -> locale-formatted in local
                            // time) was itself fine, but toDateInputValue() reading a *locale*
                            // string back (locale-parsed in local time -> UTC date extracted) is
                            // not its inverse, and silently shifted the date shown in this same
                            // input back by one day on the order's next reload/refetch.
                            if (v) updateDelivery(o.id, v, o);
                            openNotify(o);
                          }} style={{ background: 'var(--gd)', border: 'none', color: 'var(--text-dark)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  padding: '8px 14px', cursor: 'pointer' }}>Set &amp; Notify</button>
                        </div>
                        {o.estimated_delivery && <div style={{ fontFamily: 'var(--font-body)', fontSize: 16, color: 'var(--gd)', marginTop: 5, fontStyle: 'normal' }}>Set: {formatDeliveryLabel(o.estimated_delivery)}</div>}
                      </div>
                    </div>
                    {notifyOrderId === o.id && (
                      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px dashed var(--adm-border-strong)' }}>
                        <label style={{ ...lbl, marginBottom: 6 }}>Send Notification Email</label>
                        {orderTemplates === null ? (
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--adm-body)' }}>Loading templates…</div>
                        ) : orderTemplates.length === 0 ? (
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--adm-body)', fontStyle: 'normal' }}>No enabled order email templates yet -- create one under Email Templates first.</div>
                        ) : (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <select value={notifyTemplateId} onChange={e => setNotifyTemplateId(e.target.value)} style={{ background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', padding: '8px 12px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13, outline: 'none', cursor: 'pointer', minWidth: 260 }}>
                              {orderTemplates.map(t => <option key={t.id} value={t.id} style={{ background: '#fff' }}>{emailEventLabel(t.event_type)} — {t.name}</option>)}
                            </select>
                            <button disabled={notifySending} onClick={() => sendOrderNotification(o)} style={{ background: notifySending ? '#A9C5BF' : 'var(--gd)', border: 'none', color: 'var(--text-dark)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  padding: '8px 16px', cursor: notifySending ? 'not-allowed' : 'pointer' }}>{notifySending ? 'Sending…' : 'Send Email'}</button>
                          </div>
                        )}

                        <label style={{ ...lbl, marginTop: 16, marginBottom: 6 }}>Send Notification WhatsApp</label>
                        {orderWhatsAppTemplates === null ? (
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--adm-body)' }}>Loading templates…</div>
                        ) : orderWhatsAppTemplates.length === 0 ? (
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--adm-body)', fontStyle: 'normal' }}>No enabled WhatsApp templates yet -- create one under WhatsApp Templates first.</div>
                        ) : (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <select value={waNotifyTemplateId} onChange={e => setWaNotifyTemplateId(e.target.value)} style={{ background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', padding: '8px 12px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13, outline: 'none', cursor: 'pointer', minWidth: 260 }}>
                              {orderWhatsAppTemplates.map(t => <option key={t.id} value={t.id} style={{ background: '#fff' }}>{whatsappEventLabel(t.event_type)} — {t.name}</option>)}
                            </select>
                            <button disabled={waNotifySending} onClick={() => sendOrderWhatsAppNotification(o)} style={{ background: waNotifySending ? '#A9C5BF' : '#25D366', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  padding: '8px 16px', cursor: waNotifySending ? 'not-allowed' : 'pointer' }}>{waNotifySending ? 'Sending…' : 'Send WhatsApp'}</button>
                          </div>
                        )}

                        <button disabled={notifySending || waNotifySending} onClick={() => setNotifyOrderId(null)} style={{ marginTop: 14, background: 'none', border: '1px solid var(--adm-border-strong)', color: 'var(--gd)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  padding: '8px 16px', cursor: (notifySending || waNotifySending) ? 'not-allowed' : 'pointer' }}>Close</button>
                      </div>
                    )}
                    {/* Phase 8 -- two real, in-page confirmation steps (never window.confirm)
                        before an order is soft-deleted. First click only reveals the second
                        step; nothing is deleted until the explicit confirm button below. */}
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px dashed var(--adm-border-strong)' }}>
                      {orderDeleteConfirmId === o.id ? (
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--error)', fontStyle: 'normal' }}>Are you sure you want to delete this order? This action cannot be undone.</span>
                          <button disabled={orderDeletingId === o.id} onClick={() => softDeleteOrder(o.id)} style={{ background: 'var(--error)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '8px 16px', cursor: orderDeletingId === o.id ? 'not-allowed' : 'pointer', opacity: orderDeletingId === o.id ? 0.6 : 1 }}>{orderDeletingId === o.id ? 'Deleting…' : 'Yes, Delete Order'}</button>
                          <button disabled={orderDeletingId === o.id} onClick={() => setOrderDeleteConfirmId(null)} style={{ background: 'none', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '8px 16px', cursor: 'pointer' }}>Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setOrderDeleteConfirmId(o.id)} style={{ background: 'none', border: '1px solid rgba(192,53,43,.4)', color: 'var(--error)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '8px 16px', cursor: 'pointer' }}>Delete Order</button>
                      )}
                    </div>
                  </div>
                ))}
                {filteredOrders.length === 0 && (
                  <div className="adm-card"><AdminEmpty icon="cart" title={ordersFiltered ? 'No orders match this filter' : 'No orders yet'} hint={ordersFiltered ? 'Try clearing a filter.' : 'New orders will appear here as soon as customers check out.'} /></div>
                )}
                <AdminPager page={safeOrderPage} pages={orderPages} total={filteredOrders.length} pageSize={ORDER_PAGE_SIZE} onPage={setOrderPage} />
              </div>
            )}
          </div>
        )}

        {/* ENQUIRIES */}
        {tab === 4 && (
          enquiriesStatus === 'loading' ? <AdminSkeleton /> : enquiriesStatus === 'error' ? (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 17, color: 'var(--error)', marginBottom: 14 }}>Unable to load enquiries.</div>
              <button onClick={retryEnquiries} style={{ background: 'none', border: '1px solid var(--adm-border-strong)', color: 'var(--gd)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  padding: '9px 18px', cursor: 'pointer' }}>Retry</button>
            </div>
          ) : (
          <div>
            <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14,  color: 'var(--gd)',  marginBottom: 16 }}>Enquiries ({filteredEnquiries.length}{enquiriesFiltered ? ` of ${enquiries.length}` : ''})</div>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20, padding: '16px 18px', background: '#FFFFFF', border: '1px solid var(--adm-border)', borderRadius: 8 }}>
              <div>
                <label style={{ ...lbl, marginBottom: 6 }}>Status</label>
                <select value={enquiryStatusFilter} onChange={e => setEnquiryStatusFilter(e.target.value)} style={{ background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', padding: '8px 12px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  outline: 'none', cursor: 'pointer' }}>
                  <option value="All">All Statuses</option>
                  {ENQUIRY_STATUSES.map(s => <option key={s} value={s} style={{ background: '#fff' }}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={{ ...lbl, marginBottom: 6 }}>Search</label>
                <input value={enquirySearch} onChange={e => setEnquirySearch(e.target.value)} placeholder="Product, name, email, phone..." style={{ background: '#fff', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', padding: '8px 12px', fontFamily: 'var(--font-body)', fontSize: 15, outline: 'none', width: 240 }} />
              </div>
              {enquiriesFiltered && (
                <button onClick={() => { setEnquiryStatusFilter('All'); setEnquirySearch(''); }} style={{ background: 'none', border: '1px solid var(--adm-border-strong)', color: 'var(--adm-body)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '8px 14px', cursor: 'pointer' }}>Clear</button>
              )}
            </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead><tr>{['Product', 'Customer', 'Message', 'Date', 'Type', 'Status', 'Actions'].map(h => <th key={h} style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13,  padding: '10px 12px', textAlign: 'left', borderBottom: '1px solid var(--adm-border)', color: 'var(--adm-muted)' }}>{h}</th>)}</tr></thead>
              <tbody>
                {filteredEnquiries.map(e => (
                  <React.Fragment key={e.id}>
                  <tr>
                    <td style={{ padding: '12px', color: 'var(--adm-muted)', fontSize: 16, borderBottom: '1px solid var(--adm-border)' }}>{e.product || '-'}</td>
                    <td style={{ padding: '12px', fontSize: 16, color: 'var(--adm-muted)', borderBottom: '1px solid var(--adm-border)', overflowWrap: 'anywhere' }}>{e.user_name}<br /><span style={{ opacity: 0.5, fontSize: 15 }}>{e.user_email}{e.user_phone ? ` · ${e.user_phone}` : ''}</span></td>
                    <td style={{ padding: '12px', fontSize: 16, color: 'var(--adm-muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderBottom: '1px solid var(--adm-border)' }}>{e.message || '-'}</td>
                    <td style={{ padding: '12px', fontSize: 16, color: 'var(--adm-body)', borderBottom: '1px solid var(--adm-border)', whiteSpace: 'nowrap' }}>{e.created_at ? fmtDateTime(e.created_at) : '-'}</td>
                    <td style={{ padding: '12px', borderBottom: '1px solid var(--adm-border)' }}><span style={{ background: 'rgba(15,123,83,.12)', color: 'var(--success)', padding: '2px 8px', fontSize: 12, fontFamily: 'var(--font-body)', fontWeight: 600 }}>{e.type || 'Email'}</span></td>
                    <td style={{ padding: '12px', borderBottom: '1px solid var(--adm-border)' }}>
                      <select value={e.status || 'Received'} onChange={ev => updateEnquiryStatus(e.id, ev.target.value)} style={{ background: 'var(--adm-fill-2)', border: '1px solid var(--adm-border-strong)', color: 'var(--gd)', padding: '4px 8px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  outline: 'none', cursor: 'pointer' }}>
                        {ENQUIRY_STATUSES.map(s => <option key={s} value={s} style={{ background: '#fff' }}>{s}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '12px', borderBottom: '1px solid var(--adm-border)' }}>
                      {enquiryDeleteConfirmId !== e.id && (
                        <button onClick={() => setEnquiryDeleteConfirmId(e.id)} style={{ background: 'none', border: '1px solid rgba(192,53,43,.4)', color: 'var(--error)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11,  padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Delete Enquiry</button>
                      )}
                    </td>
                  </tr>
                  {/* Phase 8 -- explicit second confirmation step, full-width so the warning
                      text isn't squeezed into one narrow table cell. Never a window.confirm(). */}
                  {enquiryDeleteConfirmId === e.id && (
                    <tr>
                      <td colSpan={7} style={{ padding: '10px 12px 16px', background: 'rgba(192,53,43,.1)', borderBottom: '1px solid var(--adm-border)' }}>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--error)', fontStyle: 'normal' }}>Are you sure you want to delete this enquiry? This action cannot be undone.</span>
                          <button disabled={enquiryDeletingId === e.id} onClick={() => deleteEnquiry(e.id)} style={{ background: 'var(--error)', border: 'none', color: '#fff', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '8px 16px', cursor: enquiryDeletingId === e.id ? 'not-allowed' : 'pointer', opacity: enquiryDeletingId === e.id ? 0.6 : 1 }}>{enquiryDeletingId === e.id ? 'Deleting…' : 'Yes, Delete Enquiry'}</button>
                          <button disabled={enquiryDeletingId === e.id} onClick={() => setEnquiryDeleteConfirmId(null)} style={{ background: 'none', border: '1px solid var(--adm-border-strong)', color: 'var(--iv)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12,  padding: '8px 16px', cursor: 'pointer' }}>Cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
                {filteredEnquiries.length === 0 && <tr><td colSpan={7}><AdminEmpty icon="chat" title={enquiriesFiltered ? 'No enquiries match your filters' : 'No enquiries yet'} hint={enquiriesFiltered ? 'Try clearing a filter.' : 'Customer questions will show up here.'} /></td></tr>}
              </tbody>
            </table>
          </div>
          </div>
          )
        )}

        {/* STORIES */}
        {tab === 5 && <StoriesManager />}

        {/* COUPONS */}
        {tab === 6 && <CouponsManager />}

        {/* GIFT CARDS */}
        {tab === 7 && <GiftCardsManager />}

        {/* BRAND SETTINGS */}
        {tab === 8 && <BrandSettings />}
        {tab === 9 && <HeroSlidesManager />}
        {tab === 10 && <EmailTestPanel />}
        {tab === 11 && <EmailTemplatesManager />}
        {tab === 12 && <WhatsAppTemplatesManager />}
        {tab === 13 && <ProductNotificationsManager />}
          </div>
        </div>
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 768px) {
          .admin-body-pad { padding: 20px 16px 44px !important; }
          .admin-stats-grid { grid-template-columns: 1fr 1fr !important; gap: 12px !important; }
          .admin-dash-grid { grid-template-columns: 1fr !important; }
          .admin-form-grid { grid-template-columns: 1fr !important; }
          .admin-story-row { flex-wrap: wrap !important; }
          .admin-story-row .admin-story-actions { width: 100% !important; justify-content: flex-end !important; }
        }
        @media (max-width: 480px) {
          .admin-stats-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}