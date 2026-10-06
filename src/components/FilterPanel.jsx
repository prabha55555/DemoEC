import React, { useEffect, useState } from 'react';
import { toggleIn } from '../utils/shopQuery';
import { formatMoney } from '../utils/catalog';

const Chev = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>;
const Tick = <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>;

const RATINGS = [4, 3];
const DISCOUNTS = [10, 20, 30, 50];
const SHOW_FIRST = 6;

function Section({ id, title, open, onToggle, children }) {
  return (
    <div className="bl-fgroup">
      <button type="button" className={`bl-fgroup-title is-btn${open ? ' is-open' : ''}`} onClick={() => onToggle(id)} aria-expanded={open} aria-controls={`fp-${id}`}>
        {title}{Chev}
      </button>
      {open && <div className="bl-fgroup-body" id={`fp-${id}`}>{children}</div>}
    </div>
  );
}

// One selectable row. `radio` rows show a dot (one choice), the rest a tick box (many).
function Opt({ on, radio = false, onClick, children, count }) {
  return (
    <button type="button" className={`bl-fopt${on ? ' is-on' : ''}`} onClick={onClick} aria-pressed={on}>
      {radio ? <span className="bl-fradio" /> : <span className="bl-fcheck">{on && Tick}</span>}
      <span className="bl-fopt-t">{children}</span>
      {count !== undefined && <span className="bl-fcount">{count}</span>}
    </button>
  );
}

// A long list shows the first few and a "Show more" toggle (selected values always stay visible).
function MoreList({ items, render, selected = () => false }) {
  const [all, setAll] = useState(false);
  const head = items.slice(0, SHOW_FIRST);
  const visible = all ? items : [...head, ...items.slice(SHOW_FIRST).filter(selected)];
  return (
    <>
      {visible.map(render)}
      {items.length > SHOW_FIRST && (
        <button type="button" className="bl-fmore" onClick={() => setAll(a => !a)}>{all ? 'Show less' : `Show ${items.length - head.length} more`}</button>
      )}
    </>
  );
}

function CategoryTree({ tree, activeId, chainIds, onSelect }) {
  return (
    <>
      <Opt radio on={!activeId} onClick={() => onSelect(null)}>All categories</Opt>
      {tree.map(root => {
        const inChain = chainIds.includes(root.id);
        return (
          <div key={root.id}>
            <Opt radio on={activeId === root.id} onClick={() => onSelect(root.slug)}>
              <b style={{ fontWeight: inChain ? 600 : 500 }}>{root.name}</b>
            </Opt>
            {inChain && root.children.length > 0 && (
              <div className="bl-fchildren">
                {root.children.map(c => <Opt key={c.id} radio on={activeId === c.id} onClick={() => onSelect(c.slug)}>{c.name}</Opt>)}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

const attrValueLabel = (type, v) => (type === 'boolean' ? (String(v) === 'true' ? 'Yes' : 'No') : v);

// The filter rail (desktop) and the filter drawer (mobile) share this. It owns no filter state -- it reads the
// parsed URL state and reports changes through onChange(patch); the page writes them back to the URL.
export default function FilterPanel({ state, facets, attrSchema, tree, activeCategory, chainIds, onChange, onCategory }) {
  const [open, setOpen] = useState({});
  const isOpen = (id) => open[id] !== false;                        // everything starts expanded
  const toggle = (id) => setOpen(o => ({ ...o, [id]: o[id] === false }));

  // Price: typed values are applied together (Enter or "Go"), not on every keystroke.
  const [minDraft, setMinDraft] = useState(state.priceMin);
  const [maxDraft, setMaxDraft] = useState(state.priceMax);
  useEffect(() => { setMinDraft(state.priceMin); setMaxDraft(state.priceMax); }, [state.priceMin, state.priceMax]);
  function applyPrice(e) {
    e?.preventDefault();
    let lo = minDraft === '' ? '' : String(Math.max(0, Number(minDraft)));
    let hi = maxDraft === '' ? '' : String(Math.max(0, Number(maxDraft)));
    if (lo !== '' && hi !== '' && Number(lo) > Number(hi)) [lo, hi] = [hi, lo];
    onChange({ priceMin: lo, priceMax: hi });
  }

  const brandRows = (() => {
    const rows = (facets?.brands || []).map(b => ({ name: b.name, count: b.count }));
    for (const b of state.brands) if (!rows.some(r => r.name === b)) rows.push({ name: b, count: undefined });
    return rows;
  })();
  const pMin = facets?.price_min != null ? Math.floor(facets.price_min) : '';
  const pMax = facets?.price_max != null ? Math.ceil(facets.price_max) : '';
  const priceActive = state.priceMin !== '' || state.priceMax !== '';

  return (
    <>
      {tree.length > 0 && (
        <Section id="cat" title="Category" open={isOpen('cat')} onToggle={toggle}>
          <CategoryTree tree={tree} activeId={activeCategory?.id} chainIds={chainIds} onSelect={onCategory} />
        </Section>
      )}

      <Section id="price" title="Price" open={isOpen('price')} onToggle={toggle}>
        <form className="bl-price" onSubmit={applyPrice}>
          <label>
            <span className="sr-only">Minimum price in rupees</span>
            <input type="number" inputMode="numeric" min="0" placeholder={pMin !== '' ? `₹${pMin}` : 'Min'} value={minDraft} onChange={e => setMinDraft(e.target.value)} onBlur={() => { if (minDraft !== state.priceMin) applyPrice(); }} />
          </label>
          <span aria-hidden="true">to</span>
          <label>
            <span className="sr-only">Maximum price in rupees</span>
            <input type="number" inputMode="numeric" min="0" placeholder={pMax !== '' ? `₹${pMax}` : 'Max'} value={maxDraft} onChange={e => setMaxDraft(e.target.value)} onBlur={() => { if (maxDraft !== state.priceMax) applyPrice(); }} />
          </label>
          <button type="submit" className="bl-price-go" onMouseDown={e => e.preventDefault()}>Go</button>
        </form>
        {priceActive && <button type="button" className="bl-fmore" onClick={() => onChange({ priceMin: '', priceMax: '' })}>Clear price</button>}
        {pMin !== '' && pMax !== '' && pMax > pMin && <div className="bl-fhint">Prices here range from {formatMoney(pMin)} to {formatMoney(pMax)}</div>}
      </Section>

      {brandRows.length > 0 && (
        <Section id="brand" title="Brand" open={isOpen('brand')} onToggle={toggle}>
          <MoreList items={brandRows} selected={r => state.brands.includes(r.name)}
            render={r => <Opt key={r.name} on={state.brands.includes(r.name)} count={r.count} onClick={() => onChange({ brands: toggleIn(state.brands, r.name) })}>{r.name}</Opt>} />
        </Section>
      )}

      {attrSchema.map(a => {
        const values = (facets?.attributes?.[a.key] || []).map(v => ({ value: v.value, count: v.count }));
        const chosen = state.attrs[a.key] || [];
        for (const c of chosen) if (!values.some(v => v.value === c)) values.push({ value: c, count: undefined });
        if (!values.length) return null;
        return (
          <Section key={a.key} id={`attr-${a.key}`} title={a.unit ? `${a.label || a.key} (${a.unit})` : (a.label || a.key)} open={isOpen(`attr-${a.key}`)} onToggle={toggle}>
            <MoreList items={values} selected={v => chosen.includes(v.value)}
              render={v => (
                <Opt key={v.value} on={chosen.includes(v.value)} count={v.count}
                  onClick={() => onChange({ attrs: { ...state.attrs, [a.key]: toggleIn(chosen, v.value) } })}>{attrValueLabel(a.type, v.value)}</Opt>
              )} />
          </Section>
        );
      })}

      <Section id="rating" title="Customer rating" open={isOpen('rating')} onToggle={toggle}>
        {RATINGS.map(r => <Opt key={r} radio on={state.rating === r} onClick={() => onChange({ rating: state.rating === r ? 0 : r })}>{r}★ &amp; up</Opt>)}
      </Section>

      <Section id="discount" title="Discount" open={isOpen('discount')} onToggle={toggle}>
        {DISCOUNTS.map(d => <Opt key={d} radio on={state.discount === d} onClick={() => onChange({ discount: state.discount === d ? 0 : d })}>{d}% or more</Opt>)}
      </Section>

      <Section id="avail" title="Availability" open={isOpen('avail')} onToggle={toggle}>
        <Opt on={state.inStock} onClick={() => onChange({ inStock: !state.inStock })}>Exclude out of stock</Opt>
      </Section>
    </>
  );
}
