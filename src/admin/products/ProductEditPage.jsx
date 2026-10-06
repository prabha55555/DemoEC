import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useBrand } from '../../context/BrandContext';
import { attributeSchemaFor } from '../../utils/catalog';
import { Button, Card, ErrorState, Icon, PageHeader, Skeleton } from '../ui';
import { useConfirm, useUnsavedChanges } from '../hooks';
import useAdminCategories from './useAdminCategories';
import VariantsCard from './form/VariantsCard';
import { AttributesCard, BasicInfoCard, MediaCard, PreviewCard, SeoCard, ShippingCard, VisibilityCard } from './form/Sections';
import { reconcileOnCategoryChange } from './attributes';
import { blankForm, formFromRecord, mediaUrlsOf, validateForm } from './productForm';
import { checkDeletable, deleteProducts, duplicateProduct, fetchBase, safeDeleteMedia, saveProduct, setProductsStatus } from './productApi';
import { mergeVariantIds } from './variantMatrix';
import './products.css';

// One screen for /admin/products/new and /admin/products/:id. The wrapper only manages remounting: moving to a
// different product starts a fresh editor, but the move from /new to the id of the product that was JUST created
// keeps the same editor (and everything in it) alive, so a partly failed first save never loses what was typed.
export default function ProductEditPage() {
  const { id } = useParams();
  const created = useRef(null);
  const previous = useRef(id);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (previous.current === id) return;
    previous.current = id;
    if (!(id && id === created.current)) setEpoch(e => e + 1);
  }, [id]);
  return <ProductEditor key={epoch} initialId={id || null} onCreated={(newId) => { created.current = newId; }} />;
}

function ProductEditor({ initialId, onCreated }) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { brand } = useBrand();
  const cats = useAdminCategories();
  const first = useRef(initialId);

  const [pid, setPid] = useState(initialId);
  const [load, setLoad] = useState({ status: initialId ? 'loading' : 'ready', error: null });
  const [base, setBase] = useState(null);       // what the database holds: { product, variants }
  const [form, setForm] = useState(null);       // what is on screen
  const [saved, setSaved] = useState(null);     // the form as the database would load it (what "unsaved" is measured against)
  const [saving, setSaving] = useState(null);   // null | 'keep' | 'publish'
  const [attempt, setAttempt] = useState(null); // 'draft' | 'publish' once a save was tried: errors show from then on
  const [report, setReport] = useState(null);   // the steps of a save that partly failed
  const [serverErr, setServerErr] = useState({}); // problems only the database could find (a taken product number / SKU)
  const seeded = useRef(false);
  const [nonce, setNonce] = useState(0);

  // ---- load the product (once per editor)
  useEffect(() => {
    if (!first.current) return undefined;
    let cancelled = false;
    setLoad({ status: 'loading', error: null });
    fetchBase(first.current)
      .then((b) => { if (cancelled) return; if (!b) setLoad({ status: 'missing', error: null }); else { setBase(b); setLoad({ status: 'ready', error: null }); } })
      .catch((e) => {
        if (cancelled) return;
        // a malformed id in the address (not a UUID) is simply a product that does not exist
        if (String(e?.code) === '22P02') setLoad({ status: 'missing', error: null });
        else setLoad({ status: 'error', error: { message: e?.message || 'Could not load the product.' } });
      });
    return () => { cancelled = true; };
  }, [nonce]);

  // ---- seed the form once both the product and the categories are in
  useEffect(() => {
    if (seeded.current || cats.loading || cats.error || load.status !== 'ready') return;
    if (first.current && !base) return;
    const f = first.current ? formFromRecord(base.product, base.variants, cats.categories) : blankForm();
    seeded.current = true;
    setForm(f);
    setSaved(f);
  }, [cats.loading, cats.error, cats.categories, load.status, base]);

  const dirty = useMemo(() => !!form && !!saved && JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);
  useUnsavedChanges(dirty);

  const schema = useMemo(() => attributeSchemaFor(cats.categories, form?.category_id), [cats.categories, form?.category_id]);
  const categoryName = form?.category_id ? cats.byId.get(form.category_id)?.name : '';
  const validation = useMemo(() => (form && attempt ? validateForm(form, { categories: cats.categories, mode: attempt }) : null), [form, attempt, cats.categories]);

  const set = useCallback((key, value) => {
    if (key === 'category_id') {
      setForm((f) => {
        const r = reconcileOnCategoryChange(f.attributes, f.extras, attributeSchemaFor(cats.categories, f.category_id), attributeSchemaFor(cats.categories, value));
        return { ...f, category_id: value, attributes: r.values, extras: r.extras };
      });
    } else setForm(f => ({ ...f, [key]: value }));
  }, [cats.categories]);

  // ---- errors to show (only after the first save attempt)
  const showErrors = !!attempt;
  const errors = { ...(validation?.errors || {}) };
  const variantErrors = { ...(validation?.variantErrors || {}) };
  if (form && serverErr.product_number && form.product_number.trim() === serverErr.product_number.value) errors.product_number = serverErr.product_number.message;
  if (form && serverErr.skus?.length) {
    const taken = new Set(serverErr.skus.map(s => s.toLowerCase()));
    form.variants.forEach((v) => { if (v.sku.trim() && taken.has(v.sku.trim().toLowerCase())) variantErrors[v.key] = { ...(variantErrors[v.key] || {}), sku: 'Used by another product' }; });
  }
  const attrErrors = validation?.attrErrors || {};

  function focusFirstError() {
    setTimeout(() => {
      const el = document.querySelector('.pf [aria-invalid="true"], .pf .has-error input, .pf .has-error select, .pf .has-error textarea, .pf [role="alert"]');
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); if (typeof el.focus === 'function') el.focus({ preventScroll: true }); }
    }, 60);
  }

  // ---- save
  async function save(intent) {
    if (saving || !form) return;
    const target = intent === 'publish' ? 'active' : form.status;
    const mode = target === 'active' ? 'publish' : 'draft';
    setAttempt(mode);
    const v = validateForm(form, { categories: cats.categories, mode });
    if (!v.ok) {
      const firstMsg = Object.values(v.errors)[0];
      toast.error(`${v.count} thing${v.count === 1 ? '' : 's'} to fix before this can be saved: ${firstMsg}`);
      focusFirstError();
      return;
    }
    setSaving(intent);
    setReport(null);
    setServerErr({});
    let res;
    try {
      res = await saveProduct({ form, base, categories: cats.categories, targetStatus: target });
    } catch (e) {
      res = { ok: false, stage: 'product', steps: [{ ok: false, text: `The save failed unexpectedly: ${e?.message || e}` }], error: e?.message };
    }
    setSaving(null);

    if (res.stage === 'check') {
      if (res.field === 'product_number') setServerErr({ product_number: { value: form.product_number.trim(), message: res.error } });
      if (res.field === 'sku') setServerErr({ skus: res.skus || [] });
      toast.error(res.error);
      focusFirstError();
      return;
    }
    if (res.stage === 'product') { setReport({ ok: false, steps: res.steps }); toast.error('Nothing was saved.'); return; }

    const fresh = res.base;
    if (res.createdId) {
      setPid(res.createdId);
      onCreated(res.createdId);
      navigate(`/admin/products/${res.createdId}`, { replace: true });
    }
    if (fresh) {
      setBase(fresh);
      const snapshot = formFromRecord(fresh.product, fresh.variants, cats.categories);
      setSaved(snapshot);
      if (res.ok) { setForm(snapshot); setReport(null); setAttempt(null); toast.success(res.createdId ? 'Product created.' : target === 'active' && base?.product?.status !== 'active' ? 'Product published.' : 'Changes saved.'); }
      else {
        // keep what the admin typed, but know the ids the database gave to rows that were new
        setForm(f => ({ ...f, variants: mergeVariantIds(f.variants, fresh.variants), ...(res.createdId ? { product_number: fresh.product.product_number || f.product_number } : {}) }));
        setReport({ ok: false, steps: res.steps });
        toast.error('Some changes were saved and some were not - see the details above the form.');
      }
    } else if (!res.ok) { setReport({ ok: false, steps: res.steps }); toast.error('The save did not complete.'); }
  }

  function discard() {
    const gone = mediaUrlsOf(form).filter(u => !mediaUrlsOf(saved).includes(u));
    setForm(saved); setAttempt(null); setReport(null); setServerErr({});
    if (gone.length) safeDeleteMedia(gone); // photos uploaded in this session that were never saved
  }

  // ---- delete / duplicate
  async function remove() {
    if (!pid || !base) return;
    const sold = Number(base.product.sales_count) || 0;
    if (sold > 0) {
      const yes = await confirm({
        title: 'This product can’t be deleted', confirmLabel: 'Archive instead', cancelLabel: 'Close',
        message: `It has sold ${sold} unit${sold === 1 ? '' : 's'}, and past orders refer to it. Archive it instead: it leaves the store but its history stays.`,
      });
      if (yes) {
        const r = await setProductsStatus([pid], 'archived');
        if (r.ok) {
          setBase(b => ({ ...b, product: { ...b.product, status: 'archived' } }));
          setSaved(s => ({ ...s, status: 'archived' }));
          setForm(f => ({ ...f, status: 'archived' }));
          toast.success('Product archived.');
        } else toast.error(r.error || 'Could not archive it.');
      }
      return;
    }
    if (!(await confirm({ title: `Delete “${form.name || 'this product'}”?`, message: 'The product, its variants and its uploaded photos are removed permanently. This cannot be undone.', confirmLabel: 'Delete product', tone: 'danger' }))) return;
    try {
      const { sold: nowSold } = await checkDeletable([pid]);
      if (nowSold.length) { toast.error('This product has just been sold, so it can no longer be deleted. Archive it instead.'); return; }
    } catch { /* the delete reports its own failure */ }
    const r = await deleteProducts([pid]);
    if (!r.ok) { toast.error(r.error); return; }
    setSaved(form); // nothing left to lose
    toast.success('Product deleted.');
    navigate('/admin/products');
  }

  async function duplicate() {
    if (!pid) return;
    if (dirty) { toast.error('Save your changes first, then duplicate.'); return; }
    const t = toast.loading('Duplicating…');
    const r = await duplicateProduct(pid);
    toast.dismiss(t);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('Duplicated as a draft. Add its SKUs and stock before publishing.');
    navigate(`/admin/products/${r.id}`);
  }

  // ---- states
  const isNew = !pid;
  const crumb = form?.name?.trim() || (isNew ? 'New product' : 'Edit product');
  const back = { to: '/admin/products', label: 'All products' };
  if (cats.error) return <><PageHeader title={isNew ? 'New product' : 'Edit product'} back={back} /><Card pad={false}><ErrorState error={cats.error} onRetry={cats.reload} /></Card></>;
  if (load.status === 'error') return <><PageHeader title="Edit product" back={back} /><Card pad={false}><ErrorState error={load.error} onRetry={() => setNonce(n => n + 1)} /></Card></>;
  if (load.status === 'missing') return <><PageHeader title="Product not found" back={back} /><Card pad={false}><ErrorState title="Product not found" message="This product does not exist any more — it may have been deleted." /></Card></>;
  if (!form) return <><PageHeader title={isNew ? 'New product' : 'Edit product'} back={back} /><Card><Skeleton height={360} radius={10} /></Card></>;

  const status = form.status;
  const savedStatus = base?.product?.status;

  return (
    <div className="pf">
      <PageHeader
        title={isNew ? 'New product' : (form.name.trim() || 'Edit product')} crumbLabel={crumb}
        subtitle={isNew ? 'Add the details, options and stock. Save as a draft, or publish when it is ready.' : [base?.product?.product_number, savedStatus && `Saved as ${savedStatus}`].filter(Boolean).join(' · ')}
        actions={!isNew && (
          <>
            {savedStatus === 'active' && <Button icon="external" href={`/product/${pid}`} target="_blank">View in store</Button>}
            <Button icon="layers" to={`/admin/inventory/ledger?product=${pid}`}>Stock history</Button>
            <Button icon="copy" onClick={duplicate}>Duplicate</Button>
            <Button variant="danger" icon="trash" onClick={remove}>Delete</Button>
          </>
        )}
      />

      {report && (
        <div className="adm-note warning pf-report" role="alert">
          <strong>{report.ok ? 'Saved' : 'Some changes were saved and some were not'}</strong>
          <ul>
            {report.steps.map((s, i) => <li key={i} className={s.ok ? 'is-ok' : 'is-bad'}><Icon name={s.ok ? 'checkCircle' : 'warning'} size={15} /> <span>{s.text}</span></li>)}
          </ul>
          <p>The form still holds everything you entered. Fix what failed and save again: only what is still unsaved is written.</p>
        </div>
      )}

      <fieldset className="pf-fieldset" disabled={!!saving}>
        <div className="pf-top">
          <div className="pf-main">
            <BasicInfoCard form={form} set={set} errors={showErrors ? errors : {}} tree={cats.tree} />
            <MediaCard form={form} setForm={setForm} set={set} errors={showErrors ? errors : {}} pid={pid} />
          </div>
          <aside className="pf-side">
            <VisibilityCard form={form} set={set} errors={showErrors ? errors : {}} isNew={isNew} />
            {validation?.warnings?.length > 0 && showErrors && (
              <div className="adm-note warning" role="status">{validation.warnings.map((w, i) => <div key={i}>{w}</div>)}</div>
            )}
            <PreviewCard form={form} />
          </aside>
        </div>
        <div className="pf-rest">
          <VariantsCard form={form} setForm={setForm} errors={errors} variantErrors={variantErrors} showErrors={showErrors} />
          <AttributesCard form={form} setForm={setForm} schema={schema} attrErrors={showErrors ? attrErrors : {}} errors={showErrors ? errors : {}} categoryName={categoryName} />
          <ShippingCard form={form} set={set} errors={showErrors ? errors : {}} categories={cats.categories} brand={brand} />
          <SeoCard form={form} set={set} errors={showErrors ? errors : {}} productId={pid} />
        </div>
      </fieldset>

      <div className={`adm-savebar${dirty ? ' is-dirty' : ''}`} role="region" aria-label="Save product">
        <div className="adm-savebar-msg" aria-live="polite">
          {dirty ? <><Icon name="warning" size={16} /> You have unsaved changes.</> : <span className="adm-muted">{isNew ? 'Fill in the form, then save a draft or publish.' : 'All changes saved.'}</span>}
        </div>
        <div className="adm-savebar-btns">
          {dirty && <Button onClick={discard} disabled={!!saving}>Discard</Button>}
          {status !== 'active' && (
            <Button onClick={() => save('keep')} loading={saving === 'keep'} disabled={!!saving || !dirty}>{status === 'draft' ? 'Save draft' : 'Save changes'}</Button>
          )}
          <Button variant="primary" onClick={() => save(status === 'active' ? 'keep' : 'publish')} loading={saving === 'publish' || (status === 'active' && saving === 'keep')} disabled={!!saving || (status === 'active' && !dirty)}>
            {status === 'active' ? 'Save changes' : 'Publish'}
          </Button>
        </div>
      </div>
    </div>
  );
}
