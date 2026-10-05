import React, { useEffect, useState } from 'react';
import PageHero from './PageHero';

// Shared layout for the legal / policy pages (Terms, Privacy, Shipping): plain white title bar
// with a "last updated" line, then a two-column layout -- a sticky plain-text table of contents
// on the left (a horizontal text row under the header on phones) and one white bordered content
// card on the right. Only presentation lives here -- every page passes its own wording in unchanged.

// "7. Returns & Refunds" -> { n: '7', text: 'Returns & Refunds' }
export function splitTitle(t) {
  const m = /^(\d+)\.\s*(.*)$/.exec(t);
  return m ? { n: m[1], text: m[2] } : { n: null, text: t };
}

function jumpTo(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const ICONS = {
  shield: <><path d="M12 3l7.5 3v5.4c0 4.6-3.1 8.4-7.5 9.6-4.4-1.2-7.5-5-7.5-9.6V6L12 3z" /><path d="M8.6 12.2l2.5 2.5 4.4-4.9" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  phone: <path d="M5 4h3.5l1.8 4.6-2.3 1.5a11 11 0 0 0 5.4 5.4l1.5-2.3L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5C10.6 20 4 13.4 3.5 5.6A1.5 1.5 0 0 1 5 4z" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.2M12 7.8v.1" /></>,
};

// Highlight box for key facts: a simple bordered tinted block. tone: 'sun' (yellow tint) or 'mint'.
export function LegalCallout({ tone = 'mint', icon = 'info', title, children }) {
  return (
    <div className={`lg-callout ${tone}`}>
      <span className="lg-callout-ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[icon] || ICONS.info}</svg>
      </span>
      <div className="lg-callout-body">
        {title && <p className="lg-callout-title">{title}</p>}
        {children}
      </div>
    </div>
  );
}

// One numbered section. The leading "N." of the title becomes plain teal text in the heading.
export function LegalSection({ id, title, children }) {
  const { n, text } = splitTitle(title);
  return (
    <section id={id} className="lg-sec">
      <h2 className="lg-sec-h">
        {n && <span className="lg-num">{n}.</span>}{n ? ' ' : ''}{text}
      </h2>
      <div className="lg-sec-body">{children}</div>
    </section>
  );
}

// toc: [{ id, title }] (module-level constant so the observer is created once)
// lead: optional block shown between the title bar and the content (e.g. a summary strip)
export function LegalLayout({ crumb, title, subtitle, updated, toc, lead, children }) {
  const [active, setActive] = useState(toc[0]?.id);

  // Highlights the section currently under the header in the table of contents.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const els = toc.map((t) => document.getElementById(t.id)).filter(Boolean);
    if (!els.length) return undefined;
    const visible = new Set();
    const ob = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) visible.add(e.target.id); else visible.delete(e.target.id); });
      const first = toc.find((t) => visible.has(t.id));
      if (first) setActive(first.id);
    }, { rootMargin: '-200px 0px -55% 0px', threshold: 0 });
    els.forEach((el) => ob.observe(el));
    return () => ob.disconnect();
  }, [toc]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <PageHero crumb={crumb} title={title} subtitle={subtitle}>
        {updated && <span className="lg-updated">{updated}</span>}
      </PageHero>

      {lead && <div className="bl-wrap lg-lead">{lead}</div>}

      <div className="bl-wrap lg-wrap">
        <nav className="lg-toc" aria-label="Sections">
          <div className="lg-toc-title">On this page</div>
          <div className="lg-toc-list no-scrollbar">
            {toc.map(({ id, title: t }) => {
              const on = active === id;
              return (
                <button key={id} type="button" className={`lg-link${on ? ' is-on' : ''}`} aria-current={on ? 'true' : undefined} onClick={() => { setActive(id); jumpTo(id); }}>
                  {t}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="lg-card">{children}</div>
      </div>

      <style>{`
        .lg-updated { display: block; margin-top: 6px; font-size: 12.5px; color: var(--text-muted); }
        .bl-wrap.lg-lead { padding-top: 14px; padding-bottom: 2px; }

        .bl-wrap.lg-wrap { --lg-gutter: 14px; display: block; padding-top: 0; padding-bottom: 32px; }
        @media (min-width: 768px) { .bl-wrap.lg-wrap { --lg-gutter: 20px; } }

        /* TOC: phone/tablet = sticky plain-text row under the header */
        .lg-toc { position: sticky; top: var(--hdr-h); z-index: 90; background: #fff; border-bottom: 1px solid var(--line); margin: 0 calc(-1 * var(--lg-gutter)) 12px; }
        .lg-toc-title { display: none; }
        .lg-toc-list { display: flex; overflow-x: auto; padding: 0 calc(var(--lg-gutter) - 10px); }
        .lg-link { flex-shrink: 0; white-space: nowrap; padding: 12px 10px 10px; background: none; border: none; border-bottom: 2px solid transparent; font-family: var(--font-body); font-size: 13px; line-height: 1.3; color: var(--text-muted); transition: color .12s, border-color .12s; }
        .lg-link:hover { color: var(--primary); }
        .lg-link.is-on { color: var(--primary); border-bottom-color: var(--primary); font-weight: 500; }

        /* content card */
        .lg-card { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 18px 16px 4px; color: var(--text); font-size: 14.5px; line-height: 1.7; min-width: 0; width: 100%; }
        @media (min-width: 768px) { .lg-card { padding: 24px 32px 8px; } }

        .lg-sec { padding: 18px 0; border-bottom: 1px solid var(--border); scroll-margin-top: calc(var(--hdr-h) + 56px); }
        .lg-sec:last-of-type { border-bottom: none; }
        .lg-sec-h { font-family: var(--font-head); font-weight: 600; font-size: 16px; line-height: 1.35; color: var(--ink); margin: 0 0 8px; }
        .lg-num { color: var(--primary); }
        .lg-sec-body p { margin: 0 0 10px; }
        .lg-sec-body p:last-child { margin-bottom: 0; }

        .lg-list { margin: 10px 0 0; padding-left: 20px; list-style: disc; }
        .lg-list li { margin-bottom: 6px; padding-left: 2px; }
        .lg-list li::marker { color: var(--primary); }
        .lg-steps { list-style: none; margin: 10px 0 0; padding: 0; }
        .lg-steps li { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 8px; }
        .lg-steps li > span:first-child { flex-shrink: 0; min-width: 22px; color: var(--primary); font-weight: 600; font-size: 13.5px; }
        .lg-note { font-size: 13.5px; line-height: 1.65; margin: 12px 0 0 !important; padding: 10px 14px; background: var(--sun-tint); border: 1px solid var(--gold-border); border-radius: 6px; color: var(--sun-text); font-weight: 500; }

        /* highlight boxes: simple bordered tinted blocks */
        .lg-callout { display: flex; gap: 12px; align-items: flex-start; border: 1px solid; border-radius: 6px; padding: 12px 14px; margin: 0 0 10px; color: var(--ink); }
        .lg-callout.sun { background: var(--sun-tint); border-color: var(--gold-border); }
        .lg-callout.mint { background: var(--primary-tint); border-color: var(--primary-border); }
        .lg-callout-ico { display: flex; flex-shrink: 0; margin-top: 2px; color: var(--primary); }
        .lg-callout.sun .lg-callout-ico { color: var(--sun-text); }
        .lg-callout-body { min-width: 0; font-size: 14px; line-height: 1.65; }
        .lg-sec + .lg-callout { margin-top: 14px; }
        .lg-callout-body p { margin: 0; }
        .lg-callout-title { font-family: var(--font-head); font-weight: 600; font-size: 14.5px; margin-bottom: 2px !important; color: var(--ink); }

        /* desktop: sticky side list (plain text, active = teal + left bar) */
        @media (min-width: 900px) {
          .bl-wrap.lg-wrap { display: grid; grid-template-columns: 250px minmax(0, 920px); gap: 24px; justify-content: center; align-items: start; padding-top: 14px; }
          .lg-toc { top: calc(var(--hdr-h) + 16px); z-index: auto; margin: 0; background: none; border-bottom: none; max-height: calc(100vh - var(--hdr-h) - 32px); overflow-y: auto; }
          .lg-toc-title { display: block; font-family: var(--font-head); font-weight: 600; font-size: 12.5px; color: var(--text); padding: 0 0 8px 12px; }
          .lg-toc-list { flex-direction: column; overflow: visible; padding: 0; border-left: 1px solid var(--border); }
          .lg-link { white-space: normal; text-align: left; border-bottom: none; border-left: 2px solid transparent; margin-left: -1px; padding: 6px 10px 6px 12px; font-size: 13px; }
          .lg-link.is-on { border-bottom-color: transparent; border-left-color: var(--primary); }
          .lg-sec { scroll-margin-top: calc(var(--hdr-h) + 20px); }
        }
      `}</style>
    </div>
  );
}

export default LegalLayout;
