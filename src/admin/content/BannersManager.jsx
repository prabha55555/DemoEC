import React, { useEffect, useRef, useState } from 'react';
import { useMatch, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabase';
import ImageUploader from '../../components/ImageUploader';
import SlidePreview from '../../components/SlidePreview';
import { deleteFromStorage, staleMediaUrls } from '../../utils/supabaseStorage';
import { safeHref } from '../../utils/safeUrl';
import { HERO_CTA_POSITION_GRID, HERO_HEADLINE_SIZE_OPTIONS, HERO_SUBTEXT_SIZE_OPTIONS } from '../../utils/heroCtaPositions';
import { Button, Card, EmptyState, ErrorState, Field, FieldRow, Icon, ImagePositionPicker, NumberInput, PageHeader, PositionGrid, SaveBar, Select, Skeleton, SkeletonRows, StatusPill, Textarea, TextInput, Toggle } from '../ui';
import { adminWrite, useConfirm, useRecord, useServerList, useUnsavedChanges } from '../hooks';
import useBrandForm from '../settings/useBrandForm';

// Home page banners (the `hero_slides` table) and the slider's timing.
//   /admin/banners   the list + slider settings        /admin/banners/new, /admin/banners/:id   the slide form
const EMPTY_SLIDE = { image_url: '', image_position: '50% 50%', mobile_image_url: '', headline: '', headline_size: 'medium', mobile_headline_size: '', subtext: '', subtext_size: 'medium', cta_label: 'Shop Now', cta_link: '', cta_position: 'bottom-left', mobile_cta_position: '', show_cta: true, extra_ctas: [], display_order: 0, active: true };
const SLIDE_COLUMNS = Object.keys(EMPTY_SLIDE);
const sizeLabel = (s) => (s === 'xl' ? 'Extra large' : s[0].toUpperCase() + s.slice(1));
const CTA_POSITIONS = HERO_CTA_POSITION_GRID.flat().map(k => [k.replace('-', ' ').replace(/^./, c => c.toUpperCase()), k]);

export default function BannersManager() {
  const { id } = useParams();
  const isNew = useMatch('/admin/banners/new');
  if (isNew) return <SlideEditor key="new" />;
  if (id) return <SlideEditor key={id} id={id} />;
  return <SlideList />;
}

// ── SLIDER SETTINGS (timing / dots / arrows for the whole slider) ──
function SliderSettings() {
  const form = useBrandForm({
    initial: (b) => ({ seconds: String((Number(b.hero_slider_interval_ms) || 4000) / 1000), dots: b.hero_slider_show_dots !== false, arrows: b.hero_slider_show_arrows !== false }),
    validate: (v) => ({ seconds: !(Number(v.seconds) >= 1) ? 'Use at least 1 second.' : '' }),
    toPayload: (v) => ({ hero_slider_interval_ms: Math.max(1000, Math.round(Number(v.seconds) * 1000) || 4000), hero_slider_show_dots: v.dots, hero_slider_show_arrows: v.arrows }),
    successMessage: 'Slider settings saved.',
  });
  const { values, set, errors } = form;
  return (
    <Card title="Slider settings" subtitle="Apply to the whole home page slider, not to a single slide."
      footer={<Button variant="primary" loading={form.saving} disabled={!form.canSave} onClick={form.save}>Save settings</Button>}>
      <div className="adm-row" style={{ alignItems: 'flex-start', gap: 28 }}>
        <div style={{ width: 200 }}>
          <Field label="Auto-advance every" error={errors.seconds}><NumberInput value={values.seconds} onChange={v => set('seconds', v)} suffix="seconds" disabled={!form.loaded} /></Field>
        </div>
        <Toggle checked={values.dots} onChange={v => set('dots', v)} label="Show slide dots" disabled={!form.loaded} />
        <Toggle checked={values.arrows} onChange={v => set('arrows', v)} label="Show navigation arrows" disabled={!form.loaded} />
      </div>
    </Card>
  );
}

// ── LIST ──────────────────────────────────────────────────
function SlideList() {
  const confirm = useConfirm();
  const list = useServerList({ table: 'hero_slides', orderBy: { column: 'display_order', ascending: true }, pageSize: 50 });
  const { rows } = list;
  const drag = useRef(null);
  const [over, setOver] = useState(null);

  async function persistOrder(next) {
    const previous = rows;
    list.setRows(next.map((s, i) => ({ ...s, display_order: i })));
    const { ok } = await adminWrite(supabase.from('hero_slides').upsert(next.map((s, i) => ({ id: s.id, display_order: i }))), { failure: 'Could not save the new order.' });
    if (!ok) list.setRows(previous);
  }
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    persistOrder(next);
  };
  const onDrop = (i) => {
    setOver(null);
    if (drag.current === null || drag.current === i) return;
    const next = [...rows];
    const [moved] = next.splice(drag.current, 1);
    next.splice(i, 0, moved);
    drag.current = null;
    persistOrder(next);
  };

  async function toggleActive(s) {
    const { ok } = await adminWrite(supabase.from('hero_slides').update({ active: !s.active, updated_at: new Date().toISOString() }).eq('id', s.id), { success: s.active ? 'Banner switched off.' : 'Banner is live.' });
    if (ok) list.reload();
  }
  async function remove(s) {
    const yes = await confirm({ title: 'Delete this banner?', message: 'The slide and its images are removed permanently.', confirmLabel: 'Delete banner', tone: 'danger' });
    if (!yes) return;
    const { ok } = await adminWrite(supabase.from('hero_slides').delete().eq('id', s.id), { success: 'Banner deleted.' });
    if (ok) { deleteFromStorage([s.image_url, s.mobile_image_url]); list.reload(); }
  }

  return (
    <>
      <PageHeader title="Banners" subtitle="The slides shown at the top of your home page" actions={<Button variant="primary" icon="plus" to="/admin/banners/new">New banner</Button>} />
      <div className="adm-stack">
        <SliderSettings />
        <Card title={`Slides${list.count ? ` (${list.count})` : ''}`} subtitle="Drag to reorder, or use the arrows. Until a slide is active the store shows its default banners.">
          {list.error ? <ErrorState error={list.error} onRetry={list.reload} compact />
            : list.loading && rows.length === 0 ? <SkeletonRows rows={3} />
              : rows.length === 0 ? <EmptyState compact icon="image" title="No banner slides yet" hint="Add a slide to build the home page banner." action={<Button variant="primary" icon="plus" to="/admin/banners/new">Add the first slide</Button>} />
                : (
                  <div className="adm-rowlist">
                    {rows.map((s, i) => (
                      <div key={s.id} className={`adm-listrow${over === i ? ' is-dragover' : ''}`} draggable
                        onDragStart={() => { drag.current = i; }} onDragOver={e => { e.preventDefault(); setOver(i); }} onDragLeave={() => setOver(null)} onDrop={() => onDrop(i)}>
                        <span className="adm-grab" aria-hidden="true"><Icon name="grip" size={18} /></span>
                        <SlidePreview slide={s} width={110} height={62} />
                        <div className="adm-listrow-main">
                          <div className="adm-listrow-title">{s.headline ? s.headline.replace(/\n/g, ' ') : <span className="adm-muted">No headline</span>}</div>
                          <div className="adm-listrow-meta"><StatusPill kind="generic" status={s.active ? 'active' : 'inactive'} /><span>Position {i + 1}</span></div>
                        </div>
                        <div className="adm-listrow-actions">
                          <Button size="sm" iconOnly icon="arrowUp" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
                          <Button size="sm" iconOnly icon="arrowDown" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)} />
                          <Button size="sm" onClick={() => toggleActive(s)}>{s.active ? 'Deactivate' : 'Activate'}</Button>
                          <Button size="sm" icon="edit" to={`/admin/banners/${s.id}`}>Edit</Button>
                          <Button size="sm" variant="danger" iconOnly icon="trash" aria-label="Delete banner" onClick={() => remove(s)} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
        </Card>
      </div>
    </>
  );
}

// ── EDITOR ────────────────────────────────────────────────
function SlideEditor({ id }) {
  const navigate = useNavigate();
  const { record, loading, error, notFound, reload } = useRecord('hero_slides', id);
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [count, setCount] = useState(0); // existing slides: a new slide goes to the end

  useEffect(() => {
    if (id) {
      if (!record) return;
      const f = { ...EMPTY_SLIDE, ...Object.fromEntries(SLIDE_COLUMNS.map(k => [k, record[k] ?? EMPTY_SLIDE[k]])), extra_ctas: record.extra_ctas || [] };
      setForm(f); setSaved(f);
    }
  }, [id, record]);
  useEffect(() => {
    if (id) return undefined;
    let cancelled = false;
    supabase.from('hero_slides').select('id', { count: 'exact', head: true }).then(({ count: n }) => {
      if (cancelled) return;
      const f = { ...EMPTY_SLIDE, display_order: n || 0 };
      setCount(n || 0); setForm(f); setSaved(f);
    });
    return () => { cancelled = true; };
  }, [id]);

  const dirty = !!form && JSON.stringify(form) !== JSON.stringify(saved);
  useUnsavedChanges(dirty);
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: '' })); };
  const setCta = (i, k, v) => setForm(f => ({ ...f, extra_ctas: f.extra_ctas.map((c, idx) => (idx === i ? { ...c, [k]: v } : c)) }));

  async function save() {
    const e = {};
    if (!form.image_url) e.image_url = 'A slide image is required.';
    if (form.show_cta && !form.cta_link.trim()) e.cta_link = 'A link is required while the button is shown.';
    // SEC-XSS-3: a CTA link renders as a real <a href> on the live home page -- reject anything safeHref() would not allow there.
    else if (form.show_cta && form.cta_link.trim() && !safeHref(form.cta_link.trim())) e.cta_link = 'Use a path like /shop, or a full https:// link.';
    for (const c of form.extra_ctas) {
      if (c.link?.trim() && !safeHref(c.link.trim())) { e.extra = `"${c.label || 'Extra'}" button: use a path like /shop, or a full https:// link.`; break; }
    }
    setErrors(e);
    if (Object.keys(e).length) { toast.error('Please fix the highlighted fields.'); return; }
    setSaving(true);
    const payload = { ...Object.fromEntries(SLIDE_COLUMNS.map(k => [k, form[k]])), cta_link: form.cta_link.trim(), updated_at: new Date().toISOString() };
    const { ok } = await adminWrite(id ? supabase.from('hero_slides').update(payload).eq('id', id) : supabase.from('hero_slides').insert(payload), { success: id ? 'Banner saved.' : 'Banner added.' });
    setSaving(false);
    if (!ok) return;
    // Images replaced or removed while editing (desktop AND mobile) are orphaned files now: clean them up after a successful save.
    if (id && record) deleteFromStorage(staleMediaUrls([record.image_url, record.mobile_image_url], [form.image_url, form.mobile_image_url]));
    setSaved(form);
    navigate('/admin/banners');
  }

  if (id && loading) return <><PageHeader title="Edit banner" /><Card><Skeleton height={300} radius={10} /></Card></>;
  if (id && error) return <><PageHeader title="Edit banner" back={{ to: '/admin/banners', label: 'All banners' }} /><Card pad={false}><ErrorState error={error} onRetry={reload} /></Card></>;
  if (id && notFound) return <><PageHeader title="Banner not found" back={{ to: '/admin/banners', label: 'All banners' }} /><Card pad={false}><ErrorState title="Banner not found" message="This banner does not exist any more — it may have been deleted." /></Card></>;
  if (!form) return <><PageHeader title="New banner" /><Card><Skeleton height={300} radius={10} /></Card></>;

  return (
    <>
      <PageHeader title={id ? 'Edit banner' : 'New banner'} subtitle={id ? undefined : `This will be slide ${count + 1}.`} />
      <div className="adm-stack" style={{ maxWidth: 980 }}>
        <Card title="Image">
          <div className="adm-stack">
            <Field label="Slide image" required error={errors.image_url}>
              <ImageUploader label="Slide image" multiple={false} images={form.image_url ? [form.image_url] : []} onChange={urls => set('image_url', urls[urls.length - 1] || '')} folder="hero-slides" />
            </Field>
            <ImagePositionPicker image={form.image_url} value={form.image_position} onChange={v => set('image_position', v)} aspect="16/7" width={360} />
            <div>
              <div className="adm-label">Mobile image <span className="adm-opt">optional</span></div>
              <p className="adm-hint" style={{ margin: '2px 0 8px' }}>A tall photo shown on phones instead of the image above. If left empty, phones show the full image above uncropped.</p>
              <ImageUploader label="Mobile image" multiple={false} images={form.mobile_image_url ? [form.mobile_image_url] : []} onChange={urls => set('mobile_image_url', urls[urls.length - 1] || '')} folder="hero-slides" />
            </div>
          </div>
        </Card>

        <Card title="Text">
          <div className="adm-stack">
            <Field label="Headline" optional hint="Press Enter for a second line.">
              <Textarea rows={2} value={form.headline} maxLength={60} showCount onChange={v => set('headline', v)} placeholder={'e.g. New arrivals are here.\nPress Enter for a second line.'} />
            </Field>
            <FieldRow>
              <Field label="Headline size (desktop)"><Select value={form.headline_size} onChange={v => set('headline_size', v)} options={HERO_HEADLINE_SIZE_OPTIONS.map(s => ({ value: s, label: sizeLabel(s) }))} /></Field>
              <Field label="Headline size (mobile)" hint={form.mobile_headline_size ? undefined : 'Matches desktop.'}>
                <Select value={form.mobile_headline_size || form.headline_size} onChange={v => set('mobile_headline_size', v)} options={HERO_HEADLINE_SIZE_OPTIONS.map(s => ({ value: s, label: sizeLabel(s) }))} />
                {form.mobile_headline_size && <button type="button" className="adm-link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => set('mobile_headline_size', '')}>Reset to match desktop</button>}
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Subtext" optional><TextInput value={form.subtext} maxLength={120} onChange={v => set('subtext', v)} placeholder="e.g. Fresh finds across every category." /></Field>
              <Field label="Subtext size"><Select value={form.subtext_size} onChange={v => set('subtext_size', v)} options={HERO_SUBTEXT_SIZE_OPTIONS.map(s => ({ value: s, label: sizeLabel(s) }))} /></Field>
            </FieldRow>
          </div>
        </Card>

        <Card title="Buttons and layout">
          <div className="adm-stack">
            <Toggle checked={form.show_cta} onChange={v => set('show_cta', v)} label="Show a button on this slide" />
            {form.show_cta && (
              <>
                <FieldRow>
                  <Field label="Button 1 label"><TextInput value={form.cta_label} onChange={v => set('cta_label', v)} placeholder="Shop Now" /></Field>
                  <Field label="Button 1 link" required error={errors.cta_link}><TextInput value={form.cta_link} onChange={v => set('cta_link', v)} placeholder="/shop or https://…" /></Field>
                </FieldRow>
                {form.extra_ctas.map((c, i) => (
                  <FieldRow key={i}>
                    <Field label={`Button ${i + 2} label`}><TextInput value={c.label} onChange={v => setCta(i, 'label', v)} placeholder="Learn more" /></Field>
                    <Field label={`Button ${i + 2} link`}>
                      <div className="adm-row" style={{ flexWrap: 'nowrap' }}>
                        <div className="adm-grow"><TextInput value={c.link} onChange={v => setCta(i, 'link', v)} placeholder="/about or https://…" /></div>
                        <Button iconOnly icon="close" aria-label={`Remove button ${i + 2}`} onClick={() => set('extra_ctas', form.extra_ctas.filter((_, idx) => idx !== i))} />
                      </div>
                    </Field>
                  </FieldRow>
                ))}
                {errors.extra && <div className="adm-error" role="alert">{errors.extra}</div>}
                <div><Button size="sm" icon="plus" onClick={() => set('extra_ctas', [...form.extra_ctas, { label: '', link: '' }])}>Add another button</Button></div>
              </>
            )}
            <div className="adm-row" style={{ gap: 36, alignItems: 'flex-start' }}>
              <div>
                <div className="adm-label" style={{ marginBottom: 6 }}>Text position (desktop)</div>
                <PositionGrid options={CTA_POSITIONS} value={form.cta_position} onChange={v => set('cta_position', v)} size={40} label="Text position on desktop" />
              </div>
              <div>
                <div className="adm-label" style={{ marginBottom: 6 }}>Text position (mobile)</div>
                <PositionGrid options={CTA_POSITIONS} value={form.mobile_cta_position || form.cta_position} onChange={v => set('mobile_cta_position', v)} size={40} label="Text position on mobile" />
                {form.mobile_cta_position && <button type="button" className="adm-link-btn" style={{ marginTop: 6 }} onClick={() => set('mobile_cta_position', '')}>Reset to match desktop</button>}
              </div>
            </div>
          </div>
        </Card>

        <Card title="Preview">
          <div className="adm-row" style={{ alignItems: 'flex-end', gap: 20 }}>
            {/* Fluid up to 360px so the preview never pushes a phone-width page sideways. */}
            <div style={{ width: '100%', maxWidth: 360 }}><div className="adm-hint" style={{ marginBottom: 6 }}>Desktop</div><SlidePreview slide={form} width="100%" height={200} /></div>
            <div><div className="adm-hint" style={{ marginBottom: 6 }}>Mobile</div><SlidePreview slide={form} width={150} height={260} mobile /></div>
          </div>
        </Card>

        <Card><Toggle checked={form.active} onChange={v => set('active', v)} label="Active" hint="Visible on the live site." /></Card>
        <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => { setForm(saved); setErrors({}); }} saveLabel={id ? 'Save banner' : 'Add banner'} />
      </div>
    </>
  );
}
