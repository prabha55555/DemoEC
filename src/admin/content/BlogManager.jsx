import React, { useEffect, useState } from 'react';
import { useMatch, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabase';
import { useBrand } from '../../context/BrandContext';
import ImageUploader from '../../components/ImageUploader';
import { deleteFromStorage, staleMediaUrls } from '../../utils/supabaseStorage';
import { Button, Card, DataTable, DateTime, ErrorState, Field, FilterBar, PageHeader, Pagination, SaveBar, Select, Skeleton, StatusPill, Textarea, TextInput, Thumb, Toggle } from '../ui';
import { adminWrite, useConfirm, useRecord, useServerList, useUnsavedChanges, useUrlFilters } from '../hooks';

// Blog posts (the `stories` table, shown on the storefront as "Insights"). One screen, three URLs:
//   /admin/blog           the list        /admin/blog/new   a blank form        /admin/blog/:id   the form for a post
const CATEGORIES = ['Company News', 'New Arrivals', 'Shopping Guides', 'How-To Guides'];
const FIELDS = 'id, title, subtitle, category, author, published, images, created_at';

export default function BlogManager() {
  const { id } = useParams();
  const isNew = useMatch('/admin/blog/new');
  if (isNew) return <BlogEditor key="new" />;
  if (id) return <BlogEditor key={id} id={id} />;
  return <BlogList />;
}

// ── LIST ──────────────────────────────────────────────────
function BlogList() {
  const confirm = useConfirm();
  const { values, set, reset, active } = useUrlFilters({ q: '', status: '', page: 1 });
  const list = useServerList({
    table: 'stories', select: FIELDS, search: values.q, searchColumns: ['title', 'subtitle', 'author'],
    filters: { published: values.status === 'published' ? true : values.status === 'draft' ? false : '' },
    orderBy: { column: 'created_at', ascending: false }, pageSize: 20, page: values.page, onPageChange: p => set({ page: p }),
  });

  async function togglePublish(post) {
    const { ok } = await adminWrite(supabase.from('stories').update({ published: !post.published, updated_at: new Date().toISOString() }).eq('id', post.id),
      { success: post.published ? 'Post unpublished.' : 'Post published.' });
    if (ok) list.reload();
  }

  async function remove(post) {
    const yes = await confirm({ title: `Delete “${post.title || 'Untitled'}”?`, message: 'The post and its photos are removed permanently.', confirmLabel: 'Delete post', tone: 'danger' });
    if (!yes) return;
    const { ok } = await adminWrite(supabase.from('stories').delete().eq('id', post.id), { success: 'Post deleted.' });
    if (ok) { deleteFromStorage(post.images); list.reload(); }
  }

  return (
    <>
      <PageHeader title="Blog posts" subtitle="Articles shown on the Insights page of your store"
        actions={<Button variant="primary" icon="plus" to="/admin/blog/new">New post</Button>} />
      <FilterBar
        search={values.q} onSearch={q => set({ q })} searchPlaceholder="Search title or author…"
        selects={[{ key: 'status', label: 'Status', value: values.status, onChange: v => set({ status: v }), allLabel: 'All posts', options: [{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Drafts' }] }]}
        showClear={active} onClear={reset}
      />
      <DataTable
        caption="Blog posts" rowHref={p => `/admin/blog/${p.id}`}
        columns={[
          { key: 'title', header: 'Post', render: p => (
            <span className="adm-cell-thumb">
              <Thumb src={p.images?.[0]} width={96} />
              <span><span>{p.title || 'Untitled'}</span>{p.subtitle && <span className="adm-cell-sub" style={{ display: 'block' }}>{p.subtitle}</span>}</span>
            </span>
          ) },
          { key: 'category', header: 'Category', hideOnMobile: true, render: p => <span className="adm-chip">{p.category}</span> },
          { key: 'published', header: 'Status', render: p => <StatusPill kind="generic" status={p.published ? 'published' : 'draft'} /> },
          { key: 'created_at', header: 'Created', hideOnMobile: true, render: p => <DateTime value={p.created_at} dateOnly /> },
          { key: 'actions', header: '', mobileLabel: '', align: 'right', render: p => (
            <div className="adm-cell-actions">
              <Button size="sm" onClick={() => togglePublish(p)}>{p.published ? 'Unpublish' : 'Publish'}</Button>
              <Button size="sm" variant="danger" iconOnly icon="trash" aria-label={`Delete ${p.title || 'post'}`} onClick={() => remove(p)} />
            </div>
          ) },
        ]}
        rows={list.rows} loading={list.loading} error={list.error} onRetry={list.reload}
        empty={active
          ? { icon: 'search', title: 'No posts match your filters', hint: 'Try clearing the search or status filter.' }
          : { icon: 'doc', title: 'No blog posts yet', hint: 'Publish tips, buying guides and news to bring shoppers to your store.', action: <Button variant="primary" icon="plus" to="/admin/blog/new">Write your first post</Button> }}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.count} onPage={list.setPage} />}
      />
    </>
  );
}

// ── EDITOR ────────────────────────────────────────────────
function BlogEditor({ id }) {
  const { brand } = useBrand();
  const navigate = useNavigate();
  const { record, loading, error, notFound, reload } = useRecord('stories', id);
  // A new post starts from a blank form (author defaults to the store name); an existing one is filled in from the row.
  const makeBlank = () => ({ title: '', subtitle: '', category: CATEGORIES[0], author: brand.brand_name || '', story: '', images: [], published: true });
  const [form, setForm] = useState(() => (id ? null : makeBlank()));
  const [saved, setSaved] = useState(() => (id ? null : makeBlank())); // the form as last loaded / saved -- what "unsaved" is measured against
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  // Seed the form from the loaded row ONCE per row. (It must not depend on `form`: that would re-run after every
  // keystroke and put the row's old values straight back.)
  useEffect(() => {
    if (!id || !record) return;
    const f = { title: record.title || '', subtitle: record.subtitle || '', category: record.category || CATEGORIES[0], author: record.author || '', story: record.story || '', images: record.images || [], published: record.published !== false };
    setForm(f); setSaved(f);
  }, [id, record]);

  const dirty = !!form && JSON.stringify(form) !== JSON.stringify(saved);
  useUnsavedChanges(dirty);
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: '' })); };

  async function save() {
    if (!form.title.trim()) { setErrors({ title: 'A title is required.' }); toast.error('Add a title first.'); return; }
    setSaving(true);
    const payload = { title: form.title.trim(), subtitle: form.subtitle.trim(), category: form.category, author: form.author.trim(), story: form.story, images: form.images, published: form.published, updated_at: new Date().toISOString() };
    const { ok } = await adminWrite(id ? supabase.from('stories').update(payload).eq('id', id) : supabase.from('stories').insert(payload),
      { success: id ? 'Post saved.' : 'Post created.' });
    setSaving(false);
    if (!ok) return;
    // Photos that were replaced or removed while editing are now orphans: delete them once the save succeeded.
    if (id && record) deleteFromStorage(staleMediaUrls(record.images, form.images));
    setSaved(form);
    navigate('/admin/blog'); // the unsaved-changes guard only watches link clicks and tab close, never this redirect
  }

  if (id && loading) return <><PageHeader title="Edit post" /><Card><Skeleton height={300} radius={10} /></Card></>;
  if (id && error) return <><PageHeader title="Edit post" back={{ to: '/admin/blog', label: 'All posts' }} /><Card pad={false}><ErrorState error={error} onRetry={reload} /></Card></>;
  if (id && notFound) return <><PageHeader title="Post not found" back={{ to: '/admin/blog', label: 'All posts' }} /><Card pad={false}><ErrorState title="Post not found" message="This post does not exist any more — it may have been deleted." /></Card></>;
  if (!form) return null;

  return (
    <>
      <PageHeader title={id ? 'Edit post' : 'New post'} crumbLabel={form.title || (id ? 'Edit post' : 'New post')}
        actions={id && form.published ? <Button icon="external" href={`/insights/${id}`} target="_blank">View on site</Button> : null} />
      <div className="adm-stack" style={{ maxWidth: 900 }}>
        <Card>
          <div className="adm-stack">
            <Field label="Title" required error={errors.title}><TextInput value={form.title} onChange={v => set('title', v)} placeholder="e.g. 5 tips for choosing the right size online" maxLength={160} /></Field>
            <Field label="Subtitle" optional hint="One line shown under the title."><TextInput value={form.subtitle} onChange={v => set('subtitle', v)} placeholder="A short summary of the post" maxLength={240} /></Field>
            <div className="adm-field-row cols-2">
              <Field label="Category"><Select value={form.category} onChange={v => set('category', v)} options={CATEGORIES} /></Field>
              <Field label="Author"><TextInput value={form.author} onChange={v => set('author', v)} /></Field>
            </div>
            <Field label="Article text"><Textarea rows={12} value={form.story} onChange={v => set('story', v)} placeholder="Write the full article here…" /></Field>
            <ImageUploader key={id || 'new'} label="Photos" images={form.images} onChange={imgs => set('images', imgs)} folder="stories" help="The first photo is the cover image." />
            <Toggle checked={form.published} onChange={v => set('published', v)} label="Published" hint="Visible on the public Insights page. Turn off to keep it as a draft." />
          </div>
        </Card>
        <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => setForm(saved)} saveLabel={id ? 'Save post' : 'Create post'} />
      </div>
    </>
  );
}
