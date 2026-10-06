import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ProductCard, { ProductGridSkeleton } from './ProductCard';
import { fetchProducts } from '../utils/catalogApi';

// A titled, horizontally scrolling row of products. Either hand it `products` you already have, or a `query`
// (fetchProducts options) and it loads them itself -- showing skeletons meanwhile and disappearing when there is
// nothing to show (an empty shelf is noise on a home page).
export function ProductRail({ products }) {
  return (
    <div className="bl-rail no-scrollbar" role="list">
      {products.map(p => <div key={p.id} role="listitem" style={{ minWidth: 0 }}><ProductCard product={p} /></div>)}
    </div>
  );
}

export function ShelfHead({ title, sub, to, linkLabel = 'View all' }) {
  return (
    <div className="bl-sec-head">
      <div>
        <h2 className="bl-sec-title">{title}</h2>
        {sub && <div className="bl-sec-sub">{sub}</div>}
      </div>
      {to && <Link to={to} className="bl-link-all">{linkLabel} <span aria-hidden="true">&rsaquo;</span></Link>}
    </div>
  );
}

export default function ProductShelf({ title, sub, to, linkLabel, query, pageSize = 12, tinted = false, onResult }) {
  const [rows, setRows] = useState(null);          // null = loading
  // The query object is rebuilt on every render of the parent; its content is what identifies it.
  const key = useMemo(() => JSON.stringify(query), [query]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    fetchProducts({ ...JSON.parse(key), pageSize, page: 1 })
      .then(({ rows: r }) => { if (!cancelled) { setRows(r); onResult?.(r.length); } })
      .catch(() => { if (!cancelled) { setRows([]); onResult?.(0); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [key, pageSize]);

  if (rows && rows.length === 0) return null;
  const body = (
    <>
      <ShelfHead title={title} sub={sub} to={to} linkLabel={linkLabel} />
      {rows === null ? <ProductGridSkeleton count={6} className="bl-rail bl-rail-skel no-scrollbar" /> : <ProductRail products={rows} />}
    </>
  );
  return (
    <section className="bl-wrap bl-sec" aria-label={title}>
      {tinted ? <div className="bl-tint">{body}</div> : body}
    </section>
  );
}
