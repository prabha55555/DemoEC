import React from 'react';

// Read-only star display (and the building block for the review form). `value` is 0-5, fractions allowed
// (a 4.5 shows four full stars and a half). Renders nothing when there are no ratings and `hideEmpty` is set,
// so a brand-new product never shows a row of empty stars.
export default function StarRating({ value = 0, count = null, size = 14, hideEmpty = false, showValue = false }) {
  const v = Math.max(0, Math.min(5, Number(value) || 0));
  if (hideEmpty && v === 0) return null;
  const pct = (v / 5) * 100;
  const star = (key) => (
    <svg key={key} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.5 6.1 20.7l1.2-6.6L2.5 9.5l6.6-.9L12 2.5z" fill="currentColor" />
    </svg>
  );
  const row = [0, 1, 2, 3, 4].map(star);
  return (
    <span className="star-rating" role="img" aria-label={`${v.toFixed(1)} out of 5${count !== null ? `, ${count} ratings` : ''}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, lineHeight: 1 }}>
      <span style={{ position: 'relative', display: 'inline-flex', color: '#D5DDDB' }}>
        <span style={{ display: 'inline-flex', gap: 1 }}>{row}</span>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, overflow: 'hidden', color: '#F59E0B' }}>
          <span style={{ display: 'inline-flex', gap: 1 }}>{row}</span>
        </span>
      </span>
      {showValue && <span style={{ fontSize: size - 1, fontWeight: 600, color: 'var(--text)' }}>{v.toFixed(1)}</span>}
      {count !== null && <span style={{ fontSize: size - 2, color: 'var(--text-muted)' }}>({Number(count).toLocaleString('en-IN')})</span>}
    </span>
  );
}
