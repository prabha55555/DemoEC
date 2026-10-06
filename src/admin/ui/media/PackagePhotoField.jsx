import React, { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { uploadToStorage } from '../../../utils/supabaseStorage';
import Button from '../Button';

// A photo of the actual packed parcel, per order. It is sent over WhatsApp in place of the generic product
// photo for Shipped / Delivered messages (templates that use {{photo_url}}).
//   <PackagePhotoField order={order} onSave={async (orderId, url) => { …write orders.package_image_url… }} />
// onSave(order.id, url) runs after an upload, and onSave(order.id, null) when the photo is removed. It should
// return/throw normally; this component shows the upload spinner and any upload error.
export default function PackagePhotoField({ order, onSave }) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadToStorage(file, 'orders');
      await onSave(order.id, url);
    } catch (err) {
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  return (
    <div className="adm-pkg-photo">
      {order.package_image_url && <img src={order.package_image_url} alt="Packed order" />}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      <Button size="sm" icon="upload" loading={uploading} onClick={() => fileRef.current && fileRef.current.click()}>
        {uploading ? 'Uploading…' : order.package_image_url ? 'Replace photo' : 'Upload package photo'}
      </Button>
      {order.package_image_url && !uploading && (
        <Button variant="link" size="sm" onClick={() => onSave(order.id, null)}>Remove</Button>
      )}
    </div>
  );
}
