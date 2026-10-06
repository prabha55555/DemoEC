import React, { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { uploadToStorage } from '../../../utils/supabaseStorage';
import { safeHref } from '../../../utils/safeUrl';
import Button from '../Button';
import { TextInput } from '../Field';

// A paste-a-URL box plus an "Upload file" button (Supabase Storage) for ONE logo / hero / video field.
//   <MediaUrlField value={draft} onChange={setDraft} onSave={url => save(url)} accept="image/*" folder="brand" />
// onSave(url) fires with the pasted URL when "Save" is pressed, or with the uploaded file's public URL right
// after a successful upload. `accept="video/*"` for video fields.
export default function MediaUrlField({ value, onChange, onSave, placeholder = 'Paste an image URL…', accept = 'image/*', saveLabel = 'Save', folder = 'brand', label = 'Media URL' }) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  function saveUrl() {
    const v = String(value || '').trim();
    if (!v) { toast.error('Paste a URL first, or upload a file.'); return; }
    // A pasted URL ends up in an <img src> / <video src>: only http(s) links and site paths are allowed.
    if (!safeHref(v) || /^(mailto|tel):/i.test(v)) { toast.error('That does not look like a valid web address.'); return; }
    onSave(v);
  }

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadToStorage(file, folder);
      await onSave(url);
      toast.success('Uploaded.');
    } catch (err) {
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  return (
    <div className="adm-media-url">
      <TextInput value={value} onChange={onChange} placeholder={placeholder} aria-label={label} type="url" inputMode="url" autoCapitalize="none" spellCheck={false}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveUrl(); } }} />
      <Button variant="primary" onClick={saveUrl}>{saveLabel}</Button>
      <input ref={fileRef} type="file" accept={accept} hidden onChange={onFile} />
      <Button icon="upload" loading={uploading} onClick={() => fileRef.current && fileRef.current.click()}>{uploading ? 'Uploading…' : 'Upload file'}</Button>
    </div>
  );
}
