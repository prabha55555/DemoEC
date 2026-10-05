import React, { useEffect, useRef } from 'react';
import { COMPANY } from '../config/company';

// A centred tagline block -- a short statement with a plain attribution line underneath,
// in a flat white bordered card. Reveals gently on scroll.
// `text` may contain "\n" for a manual line break.
export default function Verse({ text, attribution = COMPANY.name, background = 'var(--bg)' }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ob = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); ob.unobserve(e.target); } });
    }, { threshold: 0.2 });
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  return (
    <section style={{ background, padding: 'clamp(1.25rem,3vw,2rem) 14px' }}>
      <div ref={ref} className="reveal vs-card">
        <span aria-hidden="true" className="vs-quote">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M9.5 6C6.5 7 4.5 9.6 4.5 13v5h6v-6H7.6c.1-2 1.2-3.3 3.2-4L9.5 6zm9 0C15.5 7 13.5 9.6 13.5 13v5h6v-6h-2.9c.1-2 1.2-3.3 3.2-4L18.5 6z" /></svg>
        </span>
        {/* whiteSpace: 'pre-line' -- a manual line break in `text` renders as one,
            while text with no embedded newlines still wraps normally. */}
        <blockquote className="vs-text" style={{ whiteSpace: 'pre-line' }}>
          {text}
        </blockquote>
        <p className="vs-by">{attribution}</p>
      </div>
      <style>{`
        .vs-card { max-width: 820px; margin: 0 auto; text-align: center; background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: clamp(20px, 4vw, 32px) clamp(16px, 4vw, 40px); }
        .vs-quote { display: inline-flex; color: var(--primary); margin-bottom: 8px; }
        .vs-text { font-family: var(--font-head); font-size: clamp(1.05rem, 2vw, 1.25rem); font-weight: 500; color: var(--ink); line-height: 1.5; margin: 0 0 .75rem; }
        .vs-by { font-size: 13px; font-weight: 500; color: var(--text-muted); margin: 0; }
      `}</style>
    </section>
  );
}
