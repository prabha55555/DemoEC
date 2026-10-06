import React from 'react';

// A shimmering placeholder block shown while data loads. <Skeleton width={120} height={14} />
// Decorative: wrap a group in role="status" aria-label="Loading" (SkeletonRows does) so it is announced once.
export function Skeleton({ width = '100%', height = 14, radius, className = '', style }) {
  return <span className={`adm-skel ${className}`.trim()} style={{ display: 'block', width, height, borderRadius: radius, ...style }} aria-hidden="true" />;
}

// A stack of list-row placeholders (thumbnail + two lines), for lists that are not a DataTable.
export function SkeletonRows({ rows = 5, thumb = true }) {
  return (
    <div className="adm-skel-rows" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="adm-skel-row">
          {thumb && <Skeleton width={44} height={44} radius={10} />}
          <div style={{ flex: 1, display: 'grid', gap: 8 }}>
            <Skeleton height={12} width={`${58 + (i % 3) * 12}%`} />
            <Skeleton height={10} width={`${28 + (i % 2) * 18}%`} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default Skeleton;
