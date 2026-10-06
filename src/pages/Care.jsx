import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBrand } from '../context/BrandContext';
import ExpertAdviceCTA from '../components/ExpertAdviceCTA';
import PageHero from '../components/PageHero';
import { buildHelpFaqs, normaliseGuides } from '../data/careGuides';
import { usePageMeta } from '../utils/usePageMeta';
import { COMPANY } from '../config/company';

// Help Centre (/help): grouped questions that read the live store settings, followed by any extra topics the admin
// has added (brand.care_guides). Open/closed is pure UI state; the search box filters across every group.
export default function Care() {
  const { brand } = useBrand();
  usePageMeta({
    title: 'Help Centre',
    description: `Answers about orders, delivery, returns, payments and your account at ${COMPANY.name}.`,
    path: '/help',
  });

  const groups = useMemo(() => {
    const built = buildHelpFaqs(brand);
    const extra = normaliseGuides(brand.care_guides);
    return extra.length
      ? [...built, { id: 'more', title: 'More help', items: extra.map(g => ({ q: g.title, a: g.answer, steps: g.steps })) }]
      : built;
  }, [brand]);

  const [open, setOpen] = useState({ 'orders-0': true });
  const [term, setTerm] = useState('');
  const toggle = (key) => setOpen(o => ({ ...o, [key]: !o[key] }));

  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = groups
    .map(g => ({ ...g, items: g.items.map((it, i) => ({ ...it, key: `${g.id}-${i}` })).filter(it => !words.length || words.every(w => `${it.q} ${it.a} ${(it.steps || []).join(' ')}`.toLowerCase().includes(w))) }))
    .filter(g => g.items.length);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <PageHero crumb="Help Centre" title="Help Centre" subtitle="Quick answers about orders, delivery, returns and payments." />

      <section className="bl-wrap hc-page">
        <div className="hc-top">
          <div className="hc-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></svg>
            <input type="search" value={term} onChange={e => setTerm(e.target.value)} placeholder="Search the Help Centre" aria-label="Search the Help Centre" />
          </div>
          {!term && (
            <nav className="hc-jump" aria-label="Help topics">
              {groups.map(g => <a key={g.id} href={`#hc-g-${g.id}`} className="bl-chip-btn">{g.title}</a>)}
            </nav>
          )}
        </div>

        {visible.length === 0 && (
          <div className="bl-panel bl-empty" role="status">
            <h2>No answers for “{term}”</h2>
            <p>Try a different word, or get in touch below and we will help you directly.</p>
            <button type="button" className="btn btn-outline" onClick={() => setTerm('')}>Clear search</button>
          </div>
        )}

        {visible.map(g => (
          <div key={g.id} className="hc-group" id={`hc-g-${g.id}`}>
            <h2 className="hc-gh">{g.title}</h2>
            <div className="hc-list">
              {g.items.map(it => {
                const isOpen = !!words.length || !!open[it.key];
                return (
                  <article key={it.key} className={`hc-item${isOpen ? ' is-open' : ''}`}>
                    <h3 className="hc-h">
                      <button type="button" className="hc-toggle" id={`hc-t-${it.key}`} aria-expanded={isOpen} aria-controls={`hc-p-${it.key}`} onClick={() => toggle(it.key)}>
                        <span className="hc-title">{it.q}</span>
                        <span className="hc-chev" aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                        </span>
                      </button>
                    </h3>
                    <div className="hc-panel" id={`hc-p-${it.key}`} role="region" aria-labelledby={`hc-t-${it.key}`}>
                      <div>
                        <div className="hc-inner">
                          {it.a && <p className="hc-a">{it.a}</p>}
                          {it.steps?.length > 0 && <ol className="hc-steps">{it.steps.map((s, j) => <li key={j}>{s}</li>)}</ol>}
                          {it.link && <Link to={it.link.to} className="hc-more">{it.link.label} &rsaquo;</Link>}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ))}

        <div className="hc-also">
          <span className="hc-also-t">Related pages</span>
          <Link to="/shipping-policy">Shipping policy</Link>
          <Link to="/returns-policy">Returns &amp; refunds</Link>
          <Link to="/terms">Terms &amp; conditions</Link>
          <Link to="/privacy-policy">Privacy policy</Link>
        </div>
      </section>

      <ExpertAdviceCTA />

      <style>{`
        .bl-wrap.hc-page { padding-top: 16px; padding-bottom: 10px; max-width: 980px; }
        .hc-top { display: grid; gap: 12px; margin-bottom: 8px; }
        .hc-search { display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid #C8D1CF; border-radius: 6px; height: 44px; padding: 0 14px; }
        .hc-search:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(15,118,110,.12); }
        .hc-search svg { color: #6C7876; flex-shrink: 0; }
        .hc-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font-size: 14.5px; color: var(--text); }
        .hc-jump { display: flex; gap: 8px; flex-wrap: wrap; }
        .hc-group { margin-top: 18px; scroll-margin-top: calc(var(--hdr-h) + 12px); }
        .hc-gh { font-family: var(--font-head); font-weight: 600; font-size: 17px; color: var(--ink); margin: 0 0 8px; }
        .hc-list { background: #fff; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
        .hc-item + .hc-item { border-top: 1px solid var(--line); }
        .hc-h { margin: 0; font-size: inherit; font-weight: inherit; }
        .hc-toggle { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 52px; padding: 12px 16px; background: #fff; border: none; text-align: left; color: var(--ink); transition: background .12s; }
        @media (hover: hover) and (pointer: fine) { .hc-toggle:hover { background: #F8FAFA; } }
        .hc-toggle:focus-visible { outline-offset: -2px; border-radius: 6px; }
        .hc-title { flex: 1; min-width: 0; font-family: var(--font-head); font-weight: 500; font-size: 15px; line-height: 1.4; }
        .hc-chev { display: flex; flex-shrink: 0; color: var(--text-muted); transition: transform .2s var(--ease); }
        .hc-item.is-open .hc-chev { transform: rotate(180deg); color: var(--primary); }
        .hc-panel { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .25s var(--ease); }
        .hc-panel > div { min-height: 0; overflow: hidden; visibility: hidden; transition: visibility 0s .25s; }
        .hc-item.is-open .hc-panel { grid-template-rows: 1fr; }
        .hc-item.is-open .hc-panel > div { visibility: visible; transition-delay: 0s; }
        .hc-inner { padding: 0 16px 16px; max-width: 760px; }
        .hc-a { margin: 0; font-size: 14px; line-height: 1.7; color: var(--text); }
        .hc-steps { margin: 8px 0 0; padding-left: 20px; }
        .hc-steps li { margin-bottom: 6px; font-size: 14px; line-height: 1.65; }
        .hc-more { display: inline-block; margin-top: 8px; font-size: 13.5px; font-weight: 500; color: var(--primary); }
        .hc-more:hover { text-decoration: underline; }
        .hc-also { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 18px; margin-top: 22px; font-size: 14px; }
        .hc-also-t { color: var(--text-muted); }
        .hc-also a { color: var(--primary); font-weight: 500; }
        .hc-also a:hover { text-decoration: underline; text-underline-offset: 3px; }
        @media (prefers-reduced-motion: reduce) { .hc-panel { transition: none; } }
      `}</style>
    </div>
  );
}
