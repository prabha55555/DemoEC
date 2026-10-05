import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useBrand } from '../context/BrandContext';
import ExpertAdviceCTA from '../components/ExpertAdviceCTA';
import PageHero from '../components/PageHero';
import { CARE_GUIDES_DEFAULT } from '../data/careGuides';
import { usePageMeta } from '../utils/usePageMeta';
import { COMPANY } from '../config/company';

// Rendered at /help ("Help Centre"). Topics come from brand.care_guides when an admin
// has customised them, otherwise from CARE_GUIDES_DEFAULT (same {material, icon, tagline, steps, note} shape).
// Each topic is a row in a bordered accordion list (open/closed is pure UI state).
export default function Care() {
  const { brand } = useBrand();
  usePageMeta({
    title: 'Help Centre',
    description: `Help Centre — ordering, shipping, returns, product care and support at ${COMPANY.name}.`,
    path: '/help',
  });
  const guides = brand.care_guides?.length ? brand.care_guides : CARE_GUIDES_DEFAULT;
  const [open, setOpen] = useState({ 0: true });
  const toggle = (i) => setOpen((o) => ({ ...o, [i]: !o[i] }));

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <PageHero
        crumb="Help Centre"
        title="Help Centre"
        subtitle="Quick answers about orders, delivery, returns and products. Can't find what you need? Our team is available 24 hours."
      />

      <section className="bl-wrap hc-page">
        <div className="hc-list">
          {guides.map((g, i) => {
            const isOpen = !!open[i];
            const steps = g.steps || [];
            return (
              <article key={g.material} className={`hc-item${isOpen ? ' is-open' : ''}`}>
                <h2 className="hc-h">
                  <button type="button" className="hc-toggle" id={`hc-t-${i}`} aria-expanded={isOpen} aria-controls={`hc-p-${i}`} onClick={() => toggle(i)}>
                    <span className="hc-txt">
                      <span className="hc-title">{g.material}</span>
                      {g.tagline && <span className="hc-tag">{g.tagline}</span>}
                    </span>
                    <span className="hc-chev" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                    </span>
                  </button>
                </h2>

                <div className="hc-panel" id={`hc-p-${i}`} role="region" aria-labelledby={`hc-t-${i}`}>
                  <div>
                    <div className="hc-inner">
                      {steps.length > 0 && (
                        <ol className="hc-steps">
                          {steps.map((step, j) => (
                            <li key={j}>{step}</li>
                          ))}
                        </ol>
                      )}
                      {g.note && (
                        <div className="hc-note">
                          <p>{g.note}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <div className="hc-also">
          <span className="hc-also-t">See also our</span>
          <Link to="/shipping-policy">Shipping Policy</Link>
          <Link to="/terms">Terms &amp; Conditions</Link>
          <Link to="/privacy-policy">Privacy Policy</Link>
        </div>
      </section>

      <ExpertAdviceCTA />

      <style>{`
        .bl-wrap.hc-page { padding-top: 16px; padding-bottom: 10px; }
        .hc-list { background: #fff; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
        .hc-item + .hc-item { border-top: 1px solid var(--line); }

        .hc-h { margin: 0; font-size: inherit; font-weight: inherit; }
        .hc-toggle { display: flex; align-items: center; gap: 12px; width: 100%; padding: 14px 16px; background: #fff; border: none; text-align: left; color: var(--ink); font-family: var(--font-body); transition: background .12s; }
        @media (hover: hover) and (pointer: fine) { .hc-toggle:hover { background: #F8FAFA; } }
        .hc-toggle:focus-visible { outline-offset: -2px; border-radius: 6px; }
        .hc-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
        .hc-title { font-family: var(--font-head); font-weight: 500; font-size: 15px; line-height: 1.35; }
        .hc-tag { font-size: 13px; color: var(--text-muted); line-height: 1.45; }
        .hc-chev { display: flex; flex-shrink: 0; color: var(--text-muted); transition: transform .2s var(--ease); }
        .hc-item.is-open .hc-chev { transform: rotate(180deg); color: var(--primary); }

        .hc-panel { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .25s var(--ease); }
        .hc-panel > div { min-height: 0; overflow: hidden; visibility: hidden; transition: visibility 0s .25s; }
        .hc-item.is-open .hc-panel { grid-template-rows: 1fr; }
        .hc-item.is-open .hc-panel > div { visibility: visible; transition-delay: 0s; }
        .hc-inner { padding: 0 16px 16px; max-width: 860px; }

        .hc-steps { margin: 0; padding-left: 20px; list-style: decimal; }
        .hc-steps li { margin-bottom: 8px; padding-left: 4px; font-size: 14px; line-height: 1.65; color: var(--text); }
        .hc-steps li::marker { color: var(--text-muted); font-weight: 500; }
        .hc-note { margin-top: 10px; padding: 10px 14px; background: var(--sun-tint); border: 1px solid var(--gold-border); border-radius: 6px; }
        .hc-note p { margin: 0; font-size: 13.5px; line-height: 1.6; color: var(--text); }

        .hc-also { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 18px; margin-top: 16px; font-size: 14px; }
        .hc-also-t { color: var(--text-muted); }
        .hc-also a { color: var(--primary); font-weight: 500; }
        .hc-also a:hover { text-decoration: underline; text-underline-offset: 3px; }
      `}</style>
    </div>
  );
}
