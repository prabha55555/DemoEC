import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabase';
import { useCatalog } from '../../context/CatalogContext';
import ImageUploader from '../../components/ImageUploader';
import { attributeSchemaFor, categoryChain, descendantIds } from '../../utils/catalog';
import { deleteFromStorage, staleMediaUrls } from '../../utils/supabaseStorage';
import { Button, Card, EmptyState, ErrorState, Field, FieldRow, Icon, Modal, NumberInput, PageHeader, Select, Skeleton, TextInput, Textarea, Thumb, Toggle } from '../ui';
import { adminWrite, useConfirm, useUnsavedChanges } from '../hooks';
import useAdminCategories from './useAdminCategories';
import useCategoryCounts, { countProductsIn } from './categoryHooks';
import SchemaEditor, { rowsFromSchema } from './SchemaEditor';
import { normalizeSchema, validateSchemaRows } from './attributes';
import { deleteBlocker, nextSortOrder, parentChoices, reorderPatches, slugProblem, treeOptions, uniqueSlug } from './categoryTools';
import './products.css';

// Categories & attributes. The left list is the tree (groups and their sub-categories) with product counts, order
// buttons and an on / off switch; the right panel edits one category: its details, tax defaults, image and the
// ATTRIBUTE SCHEMA that product forms and shop filters are built from. Selection lives in the URL (?edit=<id>,
// ?new=1&parent=<id>) so a category can be linked to and the unsaved-changes guard sees the navigation.
export default function CategoriesPage() {
  const cats = useAdminCategories();
  const counts = useCategoryCounts(cats.categories);
  const catalog = useCatalog();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editId = params.get('edit');
  const isNew = params.get('new') === '1';
  const parentParam = params.get('parent') || '';
  const [busy, setBusy] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [moving, setMoving] = useState(null);
  const [pending, setPending] = useState(null); // an id just created: the list is still reloading, so it is not in it yet

  const refreshAll = () => { cats.reload(); counts.reload(); catalog.refresh(); };
  const selected = isNew ? null : (editId ? cats.byId.get(editId) : null);
  React.useEffect(() => { if (pending && selected && selected.id === pending) setPending(null); }, [pending, selected]);
  const panelOpen = isNew || !!editId;

  async function move(c, dir) {
    const patches = reorderPatches(cats.categories, c.id, dir);
    if (!patches.length) return;
    setBusy(c.id);
    const results = await Promise.all(patches.map(p => adminWrite(supabase.from('categories').update({ sort_order: p.sort_order }).eq('id', p.id), { silent: true })));
    setBusy('');
    const failed = results.find(r => !r.ok);
    if (failed) toast.error(failed.error.message);
    refreshAll();
  }

  async function toggleActive(c) {
    const next = !c.active;
    const own = counts.totals[c.id]?.total || 0;
    if (!next && own > 0 && !(await confirm({ title: `Hide “${c.name}”?`, message: `It disappears from the store menu and its ${own} product${own === 1 ? '' : 's'} can no longer be reached through it. Nothing is deleted; switch it back on any time.`, confirmLabel: 'Hide category' }))) return;
    setBusy(c.id);
    const { ok } = await adminWrite(supabase.from('categories').update({ active: next }).eq('id', c.id), { success: next ? `“${c.name}” is visible in the store.` : `“${c.name}” is hidden from the store.` });
    setBusy('');
    if (ok) refreshAll();
  }

  async function removeCategory(c) {
    let productCount;
    try { productCount = await countProductsIn(c.id); } catch (e) { toast.error('Could not check the products in this category. Try again.'); return; }
    const childCount = cats.categories.filter(x => x.parent_id === c.id).length;
    const blocked = deleteBlocker({ name: c.name, childCount, productCount });
    if (blocked) {
      if (productCount > 0) setMoving({ category: c, productCount, childCount, message: blocked });
      else await confirm({ title: 'This category can’t be deleted yet', message: blocked, confirmLabel: 'OK', cancelLabel: 'Close' });
      return;
    }
    if (!(await confirm({ title: `Delete “${c.name}”?`, message: 'It is removed from the store menu. This cannot be undone.', confirmLabel: 'Delete category', tone: 'danger' }))) return;
    const { ok } = await adminWrite(supabase.from('categories').delete().eq('id', c.id), { success: 'Category deleted.', errors: { 23503: 'Something still refers to this category (products or sub-categories). Move them first.' } });
    if (!ok) return;
    if (c.image_url) deleteFromStorage([c.image_url]);
    refreshAll();
    navigate('/admin/categories', { replace: true });
  }

  const list = (
    <Card title="Store menu" subtitle="Groups and their sub-categories, in the order the store shows them." pad={false}>
      {cats.loading && !cats.categories.length ? <div className="adm-skel-rows"><Skeleton height={18} /><Skeleton height={18} width="70%" /><Skeleton height={18} width="80%" /></div>
        : cats.error ? <ErrorState error={cats.error} onRetry={cats.reload} />
          : cats.tree.length === 0 ? <EmptyState icon="folder" title="No categories yet" hint="Create a group such as Fashion, then add sub-categories like Men and Women." action={<Button variant="primary" icon="plus" to="/admin/categories?new=1">Create your first group</Button>} />
            : (
              <ul className="pc-tree" aria-label="Categories">
                {cats.tree.map(root => (
                  <TreeNode key={root.id} node={root} depth={0} counts={counts} selectedId={editId} busy={busy} collapsed={collapsed}
                    onToggleCollapse={(id) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
                    onMove={move} onActive={toggleActive} />
                ))}
              </ul>
            )}
    </Card>
  );

  return (
    <>
      <PageHeader title="Categories & attributes" subtitle="Organise the store menu and decide which details each kind of product is described by"
        actions={<Button variant="primary" icon="plus" to="/admin/categories?new=1">New group</Button>} />
      <div className={`pc-layout${panelOpen ? ' is-editing' : ''}`}>
        <div className="pc-list">{list}</div>
        <div className="pc-panel">
          {panelOpen ? (
            cats.loading && !cats.categories.length ? <Card><Skeleton height={300} radius={10} /></Card>
              : !isNew && !selected && pending === editId ? <Card><Skeleton height={300} radius={10} /></Card>
              : !isNew && !selected ? <Card pad={false}><ErrorState title="Category not found" message="This category does not exist any more." onRetry={null} /><div style={{ padding: '0 20px 20px', textAlign: 'center' }}><Button to="/admin/categories">Back to categories</Button></div></Card>
                : <CategoryEditor key={selected ? selected.id : `new-${parentParam}`} category={selected} newParent={isNew ? parentParam : ''} categories={cats.categories} counts={counts}
                  onSaved={(id, wasNew) => { refreshAll(); if (wasNew) { setPending(id); navigate(`/admin/categories?edit=${id}`, { replace: true }); } }} onDelete={removeCategory} />
          ) : (
            <Card><EmptyState icon="folder" title="Select a category to edit" hint="Pick one from the list to change its name, image, tax defaults and attributes, or create a new group." compact /></Card>
          )}
        </div>
      </div>
      <MoveProductsDialog state={moving} categories={cats.categories} onClose={() => setMoving(null)} onMoved={() => { setMoving(null); refreshAll(); }} />
    </>
  );
}

function TreeNode({ node, depth, counts, selectedId, busy, collapsed, onToggleCollapse, onMove, onActive }) {
  const kids = node.children || [];
  const open = !collapsed.has(node.id);
  const t = counts.totals[node.id];
  const isOff = node.active === false;
  return (
    <li className="pc-node">
      <div className={`pc-row${selectedId === node.id ? ' is-selected' : ''}${isOff ? ' is-off' : ''}`} style={{ '--depth': depth }}>
        {kids.length > 0 ? (
          <button type="button" className="pc-fold" aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`} aria-expanded={open} onClick={() => onToggleCollapse(node.id)}>
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
          </button>
        ) : <span className="pc-fold-gap" />}
        <Link to={`/admin/categories?edit=${node.id}`} className="pc-row-main" aria-current={selectedId === node.id ? 'true' : undefined}>
          {node.image_url ? <Thumb src={node.image_url} width={80} size={34} /> : <span className="pc-ico"><Icon name={depth === 0 ? 'folder' : 'tag'} size={16} /></span>}
          <span className="pc-row-text">
            <strong>{node.name}</strong>
            <span className="adm-cell-sub">
              {counts.loading && t === undefined ? 'Counting…' : counts.error && t === undefined ? 'Count unavailable' : (() => {
                const own = t?.own ?? 0;
                const total = t?.total ?? 0;
                const plural = (n, w) => `${n.toLocaleString('en-IN')} ${w}${n === 1 ? '' : 's'}`;
                if (!kids.length) return plural(own, 'product');
                return `${plural(total, 'product')} · ${kids.length} sub-categor${kids.length === 1 ? 'y' : 'ies'}${own ? ` (${own} directly here)` : ''}`;
              })()}
              {isOff ? ' · hidden' : ''}
            </span>
          </span>
        </Link>
        <div className="pc-row-tools">
          <Toggle checked={node.active !== false} onChange={() => onActive(node)} disabled={busy === node.id} label={`Show ${node.name} in the store`} className="pc-switch" />
          <Button size="sm" variant="ghost" iconOnly icon="arrowUp" aria-label={`Move ${node.name} up`} disabled={busy === node.id} onClick={() => onMove(node, -1)} />
          <Button size="sm" variant="ghost" iconOnly icon="arrowDown" aria-label={`Move ${node.name} down`} disabled={busy === node.id} onClick={() => onMove(node, 1)} />
          {depth === 0 && <Button size="sm" variant="ghost" iconOnly icon="plus" aria-label={`Add a sub-category to ${node.name}`} to={`/admin/categories?new=1&parent=${node.id}`} />}
        </div>
      </div>
      {kids.length > 0 && open && (
        <ul className="pc-tree">
          {kids.map(k => <TreeNode key={k.id} node={k} depth={depth + 1} counts={counts} selectedId={selectedId} busy={busy} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onMove={onMove} onActive={onActive} />)}
        </ul>
      )}
    </li>
  );
}

// ───────────────────────────────────────────────────────────────────────────────────────────── the edit panel
function formFor(category, newParent, categories) {
  if (category) {
    return {
      name: category.name || '', slug: category.slug || '', slugTouched: true, parent_id: category.parent_id || '', description: category.description || '',
      image_url: category.image_url || '', active: category.active !== false, gst_rate: category.gst_rate === null || category.gst_rate === undefined ? '' : String(category.gst_rate),
      hsn_code: category.hsn_code || '', rows: rowsFromSchema(category.attribute_schema),
    };
  }
  return { name: '', slug: '', slugTouched: false, parent_id: newParent || '', description: '', image_url: '', active: true, gst_rate: '', hsn_code: '', rows: [] };
}

function CategoryEditor({ category, newParent, categories, counts, onSaved, onDelete }) {
  const isNew = !category;
  const [form, setForm] = useState(() => formFor(category, newParent, categories));
  const [saved, setSaved] = useState(form);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  useUnsavedChanges(dirty);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const ownId = category?.id || null;
  const parents = useMemo(() => parentChoices(categories, ownId), [categories, ownId]);
  const parent = form.parent_id ? categories.find(c => c.id === form.parent_id) : null;
  const inherited = useMemo(() => (form.parent_id ? attributeSchemaFor(categories, form.parent_id) : []), [categories, form.parent_id]);
  const inheritedFrom = parent ? categoryChain(categories, parent.id).reverse().map(c => c.name).join(' › ') : '';

  const slug = form.slug.trim();
  const slugErr = slug || tried ? slugProblem(slug, categories, ownId) : '';
  const schemaErrors = useMemo(() => validateSchemaRows(form.rows, inherited.map(a => a.key), inherited.map(a => a.label)), [form.rows, inherited]);
  const nameErr = tried && !form.name.trim() ? 'Enter a name.' : '';
  const gst = form.gst_rate.trim();
  const gstErr = gst !== '' && (!/^\d+(\.\d+)?$/.test(gst) || Number(gst) > 100) ? 'Enter a rate between 0 and 100.' : '';
  const hsnErr = form.hsn_code.trim() !== '' && !/^\d{2,8}$/.test(form.hsn_code.trim()) ? 'HSN codes are 2 to 8 digits.' : '';
  const schemaBad = schemaErrors.some(e => Object.keys(e).length);
  const productCount = counts.own[ownId];

  function onName(v) {
    setForm((f) => ({ ...f, name: v, ...(isNew && !f.slugTouched ? { slug: v.trim() ? uniqueSlug(v, categories, ownId) : '' } : {}) }));
  }

  async function save() {
    setTried(true);
    if (!form.name.trim() || slugProblem(slug, categories, ownId) || gstErr || hsnErr || schemaBad) { toast.error('Fix the highlighted fields first.'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(), slug, parent_id: form.parent_id || null, description: form.description.trim(), image_url: form.image_url,
      active: form.active, gst_rate: gst === '' ? null : Number(gst), hsn_code: form.hsn_code.trim() || null, attribute_schema: normalizeSchema(form.rows),
      ...(isNew ? { sort_order: nextSortOrder(categories, form.parent_id || null) } : {}),
    };
    const builder = isNew ? supabase.from('categories').insert(payload) : supabase.from('categories').update(payload).eq('id', ownId);
    const { ok, data } = await adminWrite(builder, { success: isNew ? 'Category created.' : 'Category saved.', errors: { 23505: `The slug "${slug}" is already used by another category.` } });
    setSaving(false);
    if (!ok) return;
    if (!isNew && category.image_url && category.image_url !== form.image_url) deleteFromStorage(staleMediaUrls([category.image_url], [form.image_url]));
    // The saved keys are now fixed; show the row set as it was stored.
    const snapshot = { ...form, slugTouched: true, rows: rowsFromSchema(payload.attribute_schema) };
    setForm(snapshot);
    setSaved(snapshot);
    onSaved(data[0].id, isNew);
  }

  const title = isNew ? (parent ? `New sub-category in ${parent.name}` : 'New group') : `Edit ${category.name}`;

  return (
    <div className="pc-editor adm-stack">
      <div className="pc-back"><Link to="/admin/categories" className="adm-back"><Icon name="arrowLeft" size={15} /> All categories</Link></div>
      <Card title={title} subtitle={isNew ? (parent ? 'Sub-categories appear under their group in the store menu.' : 'A group is a top-level section of the store menu, like Fashion or Electronics.') : [productCount !== undefined ? `${productCount} product${productCount === 1 ? '' : 's'} directly in this category` : '', category.parent_id ? 'Sub-category' : 'Group'].filter(Boolean).join(' · ')}>
        <div className="adm-stack">
          <FieldRow cols={2}>
            <Field label="Name" required error={nameErr}><TextInput value={form.name} onChange={onName} maxLength={60} placeholder="e.g. Men" /></Field>
            <Field label="Parent" hint={parents.length === 0 && !isNew && categories.some(c => c.parent_id === ownId) ? 'This group has sub-categories, so it stays at the top level.' : 'None makes it a top-level group.'}>
              <Select value={form.parent_id} onChange={v => set('parent_id', v)} options={parents.map(p => ({ value: p.id, label: p.name }))} placeholder="None (top-level group)" disabled={!isNew && categories.some(c => c.parent_id === ownId)} />
            </Field>
          </FieldRow>
          <Field label="Slug" required error={slugErr} hint="The category's web address: /shop/slug. Lowercase letters, numbers and hyphens.">
            <TextInput value={form.slug} onChange={v => setForm(f => ({ ...f, slug: v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''), slugTouched: true }))} maxLength={60} prefix="/shop/" />
          </Field>
          {!isNew && form.name.trim() && uniqueSlug(form.name, categories, ownId) !== slug && (
            <div className="adm-hint" style={{ marginTop: -8 }}>Renaming does not change the slug, so existing links keep working. <button type="button" className="adm-link-btn" onClick={() => setForm(f => ({ ...f, slug: uniqueSlug(f.name, categories, ownId) }))}>Use “{uniqueSlug(form.name, categories, ownId)}”</button></div>
          )}
          <Field label="Description" optional><Textarea rows={3} value={form.description} onChange={v => set('description', v)} maxLength={500} showCount placeholder="A line about this category (optional)" /></Field>
          <ImageUploader key={ownId || 'new'} label="Image" multiple={false} images={form.image_url ? [form.image_url] : []} onChange={imgs => set('image_url', imgs[0] || '')} folder="categories"
            help="Shown on the store's home page tiles. A square or wide photo works best." />
          <Toggle checked={form.active} onChange={v => set('active', v)} label="Visible in the store" hint="Off hides it from the menu and the home page. Products inside are not deleted." />
        </div>
      </Card>

      <Card title="Tax defaults" subtitle="Used for products in this category that have no GST rate of their own.">
        <FieldRow cols={2}>
          <Field label="Default GST rate" optional error={gstErr} hint="Leave blank to use the store default (Settings → Tax)."><NumberInput value={form.gst_rate} onChange={v => set('gst_rate', v)} suffix="%" /></Field>
          <Field label="Default HSN code" optional error={hsnErr}><TextInput value={form.hsn_code} onChange={v => set('hsn_code', v.replace(/\D/g, ''))} maxLength={8} inputMode="numeric" placeholder="e.g. 6109" /></Field>
        </FieldRow>
      </Card>

      <Card title="Attributes" subtitle={parent ? `Details products here are described by. ${parent.name}'s attributes are inherited automatically.` : 'Details products here are described by. Sub-categories inherit them.'}>
        <SchemaEditor rows={form.rows} onChange={rows => set('rows', rows)} inherited={inherited} inheritedFrom={inheritedFrom} errors={tried || dirty ? schemaErrors : []} />
      </Card>

      <div className={`adm-savebar${dirty ? ' is-dirty' : ''}`} role="region" aria-label="Save category">
        <div className="adm-savebar-msg" aria-live="polite">{dirty ? <><Icon name="warning" size={16} /> You have unsaved changes.</> : <span className="adm-muted">{isNew ? 'Fill in the name to create it.' : 'All changes saved.'}</span>}</div>
        <div className="adm-savebar-btns">
          {!isNew && <Button variant="danger" icon="trash" onClick={() => onDelete(category)} disabled={saving}>Delete</Button>}
          {dirty && <Button onClick={() => { setForm(saved); setTried(false); }} disabled={saving}>Discard</Button>}
          <Button variant="primary" loading={saving} disabled={!dirty && !isNew} onClick={save}>{isNew ? 'Create category' : 'Save category'}</Button>
        </div>
      </div>
    </div>
  );
}

// "Move products to…": a category with products can't be deleted, so offer to move them first.
function MoveProductsDialog({ state, categories, onClose, onMoved }) {
  const confirm = useConfirm();
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const open = !!state;
  const options = useMemo(() => (state ? treeOptions(categories, { excludeIds: descendantIds(categories, state.category.id) }) : []), [state, categories]);
  React.useEffect(() => { setTarget(''); }, [state]);
  if (!state) return <Modal open={false} onClose={onClose} />;
  const { category, productCount } = state;

  async function go() {
    if (!target) return;
    const dest = categories.find(c => c.id === target);
    setBusy(true);
    const { ok, data } = await adminWrite(supabase.from('products').update({ category_id: target }).eq('category_id', category.id), { silent: true });
    setBusy(false);
    if (!ok) { toast.error('The products could not be moved. Nothing was changed.'); return; }
    toast.success(`${data.length} product${data.length === 1 ? '' : 's'} moved to ${dest.name}.`);
    onMoved();
    if (state.childCount === 0 && await confirm({ title: `Delete “${category.name}” now?`, message: 'It is empty, so it can be deleted.', confirmLabel: 'Delete category', tone: 'danger' })) {
      const r = await adminWrite(supabase.from('categories').delete().eq('id', category.id), { success: 'Category deleted.' });
      if (r.ok) onMoved();
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Move the products out of “${category.name}”`} busy={busy}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!target} onClick={go}>Move {productCount} product{productCount === 1 ? '' : 's'}</Button></>}>
      <div className="adm-stack">
        <p className="adm-modal-text">{state.message}</p>
        <Field label="Move them to" required>
          <Select value={target} onChange={setTarget} placeholder="Choose a category" options={options.map(o => ({ value: o.value, label: o.label }))} />
        </Field>
        <p className="adm-hint">Their specification values are kept; fields the new category does not define move to “Other specifications”.</p>
      </div>
    </Modal>
  );
}
