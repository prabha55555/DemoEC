import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { useBrand } from '../../context/BrandContext';
import { thumb } from '../../utils/thumbnail';
import { Button, MediaUrlField, originalOnError } from '../ui';
import { useConfirm } from '../hooks';
import { friendlyDbError } from '../hooks/adminWrite';

// One image (or video) setting: shows what is live, lets the admin paste a URL or upload a file, and Remove.
// Images save the moment they are chosen (they are single assets, not part of a text form).
//   <BrandImageField field="logo_url" title="Logo" help="Shown in the header and emails." />
// The old file is deliberately NOT deleted from storage: logos and the confirmation-email picture are embedded in
// emails already sent, which would break.
export default function BrandImageField({ field, title, help, folder = 'brand', accept = 'image/*', kind = 'image', previewHeight = 64, placeholder }) {
  const { brand, updateBrand } = useBrand();
  const confirm = useConfirm();
  const [draft, setDraft] = useState('');
  const current = brand[field];

  async function save(url) {
    try {
      await updateBrand({ [field]: url });
      setDraft('');
      toast.success(kind === 'video' ? 'Video saved.' : 'Image saved.');
    } catch (e) { toast.error(friendlyDbError(e)); }
  }
  async function remove() {
    if (!(await confirm({ title: `Remove the ${title.toLowerCase()}?`, message: 'It will stop showing on your store.', confirmLabel: 'Remove', tone: 'danger' }))) return;
    try { await updateBrand({ [field]: '' }); toast.success('Removed.'); } catch (e) { toast.error(friendlyDbError(e)); }
  }

  return (
    <div className="adm-media-block">
      <div className="adm-media-title">{title}</div>
      {help && <p className="adm-hint">{help}</p>}
      {current && (kind === 'video'
        ? <video src={current} controls className="adm-media-preview" style={{ maxWidth: 360, background: '#000' }} />
        : <img src={thumb(current, 600)} onError={originalOnError(current)} alt={`Current ${title.toLowerCase()}`} className="adm-media-preview" style={{ maxHeight: previewHeight * 3, padding: 6, alignSelf: 'flex-start' }} />)}
      <MediaUrlField value={draft} onChange={setDraft} onSave={save} accept={accept} folder={folder} label={`${title} URL`}
        placeholder={placeholder || (kind === 'video' ? 'Paste a video URL…' : 'Paste an image URL…')} saveLabel={current ? 'Replace' : 'Save'} />
      {current && <div><Button variant="danger" size="sm" icon="trash" onClick={remove}>Remove</Button></div>}
    </div>
  );
}
