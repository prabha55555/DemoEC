import React from 'react';
import Button from '../Button';
import ImagePositionPicker from './ImagePositionPicker';
import MediaUrlField from './MediaUrlField';

// One page-banner image block: focal-point picker for the current image, a URL / upload box and a Remove button.
// Hoisted to module scope on purpose -- a component declared inside another's render is a new type every render,
// so React remounts it (and loses input focus) on every keystroke.
//
//   <HeroImageField field="hero_shop" title="Shop page banner" description="Shown at the top of the Shop page."
//     brand={brand} draft={urls.hero_shop} onDraftChange={v => setUrls(u => ({ ...u, hero_shop: v }))}
//     onSave={(field, url) => …} onRemove={field => …} onPositionChange={(field, pos) => …} />
// The current image is read from brand[field]; its focal point from brand[`${field}_position`].
export default function HeroImageField({ field, title, description, aspect = '16/5', brand, draft, onDraftChange, onSave, onRemove, onPositionChange, folder = 'brand' }) {
  const current = brand[field];
  return (
    <div className="adm-media-block">
      <div className="adm-media-title">{title}</div>
      {description && <p className="adm-hint">{description}</p>}
      {current && (
        <ImagePositionPicker image={current} value={brand[`${field}_position`]} aspect={aspect} width={aspect === '3/4' ? 260 : 460}
          onChange={v => onPositionChange(field, v)} />
      )}
      <MediaUrlField value={draft} onChange={onDraftChange} onSave={url => onSave(field, url)} folder={folder} />
      {current && <div><Button variant="danger" size="sm" icon="trash" onClick={() => onRemove(field)}>Remove image</Button></div>}
    </div>
  );
}
