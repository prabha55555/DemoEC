import React, { useState } from 'react';
import Modal from '../Modal';
import Button from '../Button';

// 3x3 focal-point grid: friendly name -> CSS object-position.
export const IMAGE_POSITIONS = [
  ['Top left', '0% 0%'], ['Top', '50% 0%'], ['Top right', '100% 0%'],
  ['Left', '0% 50%'], ['Centre', '50% 50%'], ['Right', '100% 50%'],
  ['Bottom left', '0% 100%'], ['Bottom', '50% 100%'], ['Bottom right', '100% 100%'],
];

// A 3x3 grid of dots. `options` = [[label, value], …] (9 of them, top row first). onChange(value).
export function PositionGrid({ value, onChange, options = IMAGE_POSITIONS, size = 32, label = 'Position' }) {
  return (
    <div className="adm-posgrid" role="group" aria-label={label} style={{ '--cell': `${size}px` }}>
      {options.map(([name, val]) => (
        <button key={val} type="button" title={name} aria-label={name} aria-pressed={value === val} className={value === val ? 'is-on' : ''} onClick={() => onChange(val)}>
          <span />
        </button>
      ))}
    </div>
  );
}

// "Which part of the photo stays visible when it is cropped": the full, uncropped photo next to a focal-point
// grid; click the photo to enlarge it with a live crop preview.
//   <ImagePositionPicker image={url} value={form.image_position} onChange={v => set('image_position', v)} aspect="16/7" />
export default function ImagePositionPicker({ image, value, onChange, aspect = '1/1', width = 320, label = 'Focal point — which part of the photo should stay visible when it is cropped' }) {
  const pos = value || '50% 50%';
  const [open, setOpen] = useState(false);
  return (
    <div className="adm-focal">
      <div className="adm-label">{label}</div>
      <div className="adm-focal-row">
        {image ? (
          <button type="button" className="adm-focal-img" style={{ width: `min(${width}px, 100%)` }} onClick={() => setOpen(true)} aria-label="Enlarge the photo to choose the focal point">
            <img src={image} alt="" />
            <span className="adm-focal-hint">Click to enlarge</span>
          </button>
        ) : (
          <div className="adm-focal-empty" style={{ width: `min(${width}px, 100%)` }}>Add an image to preview the crop</div>
        )}
        <PositionGrid value={pos} onChange={onChange} label="Focal point" />
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Set focal point" size="lg" footer={<Button variant="primary" onClick={() => setOpen(false)}>Done</Button>}>
        <div className="adm-focal-modal">
          <img className="adm-focal-full" src={image} alt="" />
          <div>
            <PositionGrid value={pos} onChange={onChange} size={48} label="Focal point" />
            <div className="adm-label" style={{ marginTop: 18 }}>Crop preview</div>
            <div className="adm-focal-crop" style={{ aspectRatio: aspect }}>
              {image && <img src={image} alt="" style={{ objectPosition: pos }} />}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
