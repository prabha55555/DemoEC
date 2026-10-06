import React, { useMemo, useState } from 'react';
import { supabase } from '../../supabase';
import { useCatalog } from '../../context/CatalogContext';
import { thumb } from '../../utils/thumbnail';
import { formatMoney } from '../lib/format';
import { Button, Icon, StatusPill } from '../ui';
import { sanitizeSearch } from '../hooks/serverList';
import useDebounce from '../hooks/useDebounce';
import useLoad, { rowsOf } from '../orders/useLoad';

// ------------------------------------------------------------------------------------------ products
const PRODUCT_COLUMNS = 'id, name, product_number, price, images, status';

function ProductRow({ p, action }) {
  const img = Array.isArray(p.images) ? p.images[0] : null;
  return (
    <li className="cpn-pick-row">
      {img ? <img className="adm-thumb" src={thumb(img, 88)} alt="" loading="lazy" /> : <span className="adm-thumb cpn-thumb-empty"><Icon name="box" size={16} /></span>}
      <span className="cpn-pick-main">
        <span className="cpn-pick-name">{p.name}</span>
        <span className="adm-cell-sub">{p.product_number ? `${p.product_number} · ` : ''}{p.price !== null && p.price !== undefined ? formatMoney(p.price) : ''}</span>
      </span>
      {p.status && p.status !== 'active' && <StatusPill kind="product" status={p.status} />}
      {action}
    </li>
  );
}

// A searchable product picker: type to find products, "Add" puts one in the list, "Remove" takes it out. `value` is the
// list of product ids; names for the ones already chosen are fetched by id.
//   <ProductPicker value={ids} onChange={setIds} />
export function ProductPicker({ value, onChange, label = 'Products' }) {
  const [text, setText] = useState('');
  const q = useDebounce(sanitizeSearch(text), 300);
  const ids = value || [];
  const idsKey = ids.slice().sort().join(',');
  const chosen = useLoad(() => rowsOf(supabase.from('products').select(PRODUCT_COLUMNS).in('id', ids)), [idsKey], { enabled: ids.length > 0, initial: [] });
  const found = useLoad(() => rowsOf(supabase.from('products').select(PRODUCT_COLUMNS).or(`name.ilike.%${q}%,product_number.ilike.%${q}%`).order('name').limit(12)), [q], { enabled: q.length >= 2, initial: [] });
  const byId = useMemo(() => Object.fromEntries((chosen.data || []).map(p => [p.id, p])), [chosen.data]);
  const add = (p) => { if (!ids.includes(p.id)) onChange([...ids, p.id]); };
  const remove = (id) => onChange(ids.filter(x => x !== id));

  return (
    <div className="cpn-picker">
      <div className="adm-label">{label}</div>
      {ids.length > 0 && (
        <ul className="cpn-pick-list" aria-label="Chosen products">
          {ids.map(id => (byId[id]
            ? <ProductRow key={id} p={byId[id]} action={<Button size="sm" variant="ghost" iconOnly icon="close" aria-label={`Remove ${byId[id].name}`} onClick={() => remove(id)} />} />
            : <li key={id} className="cpn-pick-row"><span className="adm-thumb cpn-thumb-empty"><Icon name="box" size={16} /></span><span className="cpn-pick-main"><span className="cpn-pick-name adm-muted">{chosen.loading ? 'Loading…' : 'A product that no longer exists'}</span></span><Button size="sm" variant="ghost" iconOnly icon="close" aria-label="Remove this product" onClick={() => remove(id)} /></li>))}
        </ul>
      )}
      <div className="adm-fb-search" style={{ maxWidth: 'none' }}>
        <Icon name="search" size={16} />
        <input type="search" value={text} onChange={e => setText(e.target.value)} placeholder="Search products by name or number…" aria-label="Search products to add" autoComplete="off" spellCheck={false} />
      </div>
      {q.length >= 2 && (
        <div className="cpn-pick-results" role="region" aria-label="Search results" aria-live="polite">
          {found.error ? <p className="adm-error" role="alert">Could not search products. {found.error.message}</p>
            : found.loading ? <p className="adm-muted" style={{ margin: 0 }}>Searching…</p>
              : (found.data || []).length === 0 ? <p className="adm-muted" style={{ margin: 0 }}>No product matches “{q}”.</p>
                : (
                  <ul className="cpn-pick-list">
                    {found.data.map(p => (
                      <ProductRow key={p.id} p={p} action={ids.includes(p.id)
                        ? <span className="adm-chip">Added</span>
                        : <Button size="sm" icon="plus" onClick={() => add(p)} aria-label={`Add ${p.name}`}>Add</Button>} />
                    ))}
                  </ul>
                )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------ categories
function CategoryNode({ node, value, onToggle, depth }) {
  const checked = value.includes(node.id);
  const kids = node.children || [];
  return (
    <li>
      <label className="cpn-cat" style={{ paddingLeft: depth * 22 }}>
        <input type="checkbox" checked={checked} onChange={() => onToggle(node.id)} />
        <span>{node.name}</span>
        {kids.length > 0 && <span className="adm-cell-sub">{kids.length} sub-categor{kids.length === 1 ? 'y' : 'ies'}</span>}
      </label>
      {kids.length > 0 && <ul className="cpn-cat-list">{kids.map(k => <CategoryNode key={k.id} node={k} value={value} onToggle={onToggle} depth={depth + 1} />)}</ul>}
    </li>
  );
}

// The category tree with a tick box on every category. A coupon on a main category also covers everything beneath it (an
// order line carries its category and all of that category's parents), so ticking "Fashion" is enough.
export function CategoryPicker({ value, onChange }) {
  const { tree, byId, loading } = useCatalog();
  const ids = value || [];
  const toggle = (id) => onChange(ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  const unknown = ids.filter(id => !byId.has(id));
  return (
    <div className="cpn-picker">
      <div className="adm-label">Categories</div>
      {loading && tree.length === 0 ? <p className="adm-muted" style={{ margin: 0 }}>Loading categories…</p>
        : tree.length === 0 ? <p className="adm-muted" style={{ margin: 0 }}>There are no categories yet. Add some under Categories first.</p>
          : <ul className="cpn-cat-list is-root" aria-label="Categories">{tree.map(n => <CategoryNode key={n.id} node={n} value={ids} onToggle={toggle} depth={0} />)}</ul>}
      {unknown.length > 0 && (
        <div className="adm-note warning">
          {unknown.length} chosen categor{unknown.length === 1 ? 'y is' : 'ies are'} switched off or deleted, so {unknown.length === 1 ? 'it' : 'they'} do not show above.
          <div style={{ marginTop: 8 }}><Button size="sm" onClick={() => onChange(ids.filter(id => byId.has(id)))}>Remove {unknown.length === 1 ? 'it' : 'them'}</Button></div>
        </div>
      )}
      <p className="adm-hint" style={{ margin: 0 }}>Choosing a main category covers all of its sub-categories.</p>
    </div>
  );
}
