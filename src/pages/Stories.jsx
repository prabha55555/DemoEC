import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase';
import { thumb } from '../utils/thumbnail';
import { fmtDate } from '../utils/orderFormat';
import { usePageMeta } from '../utils/usePageMeta';
import { COMPANY } from '../config/company';
import PageHero from '../components/PageHero';
import markImg from '../assets/brightlight-mark.png';

// Short plain-text teaser for the card: the subtitle if there is one, otherwise the opening of the body.
function excerptOf(s, max = 140) {
  const raw = (s.subtitle || s.story || '').replace(/\s+/g, ' ').trim();
  if (raw.length <= max) return raw;
  return raw.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

// Rendered at /insights and shown to customers as the Blog. Data comes from the `stories` table.
export default function Stories() {
  usePageMeta({
    title: 'Blog',
    description: `Shopping guides, news and updates from ${COMPANY.name}.`,
    path: '/insights',
  });
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('stories').select('*').eq('published', true)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setStories(data); setLoading(false); });
  }, []);

  // One article card: image on top, category chip, title, excerpt, date. The newest article carries a "Latest" badge.
  const renderCard = (s, latest) => {
    const href = `/insights/${s.id}`;
    const excerpt = excerptOf(s, 140);
    return (
      <article key={s.id} className="bg-card">
        {/* A real <Link>, not a bare onClick <img> -- keyboard-focusable and
            announced as a link out of the box. */}
        <Link to={href} aria-hidden="true" tabIndex={-1} className="bg-img">
          {s.images?.[0]
            ? <img src={thumb(s.images[0], 700)} alt="" loading="lazy" decoding="async" />
            : <span className="bg-img-ph"><img src={markImg} alt="" width="56" height="56" /></span>}
        </Link>
        <div className="bg-body">
          {(s.category || latest) && (
            <div className="bg-tags">
              {s.category && <span className="bl-chip">{s.category}</span>}
              {latest && <span className="badge badge-gold">Latest</span>}
            </div>
          )}
          <h2 className="bg-title">
            <Link to={href}>{s.title}</Link>
          </h2>
          {excerpt && <p className="bg-excerpt">{excerpt}</p>}
          <div className="bg-meta">{s.author ? `${s.author} · ` : ''}{fmtDate(s.created_at)}</div>
        </div>
      </article>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <PageHero
        crumb="Blog"
        title={`${COMPANY.shortName} Blog`}
        subtitle="Shopping guides, news and updates."
      />

      <section className="bl-wrap bg-page">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><span className="spinner"></span></div>
        ) : stories.length === 0 ? (
          <div className="bg-empty">
            <span className="bg-empty-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4.5h11a2 2 0 0 1 2 2V19a1.5 1.5 0 0 0 1.5-1.5V9H18" /><path d="M5 4.5V17a2 2 0 0 0 2 2h12" /><path d="M8.5 9h6M8.5 12.5h6" /></svg>
            </span>
            <div className="empty-state" style={{ padding: '10px 0 0' }}>No articles published yet. Please check back soon.</div>
          </div>
        ) : (
          <div className="bg-grid">
            {stories.map((s, i) => renderCard(s, i === 0))}
          </div>
        )}
      </section>

      <style>{`
        .bl-wrap.bg-page { padding-top: 16px; padding-bottom: 32px; }
        .bg-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
        @media (min-width: 640px) { .bg-grid { grid-template-columns: 1fr 1fr; } }
        @media (min-width: 1024px) { .bg-grid { grid-template-columns: repeat(3, 1fr); gap: 16px; } }
        @media (min-width: 1280px) { .bg-grid { grid-template-columns: repeat(4, 1fr); } }

        .bg-card { position: relative; display: flex; flex-direction: column; background: #fff; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; min-width: 0; transition: border-color .15s, box-shadow .15s; }
        @media (hover: hover) and (pointer: fine) { .bg-card:hover { border-color: #D2DBD9; box-shadow: var(--shadow-md); } }
        .bg-card:focus-within { border-color: var(--primary); }

        .bg-img { display: block; aspect-ratio: 16 / 10; background: #EFF3F2; overflow: hidden; }
        .bg-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .bg-img-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: var(--primary-tint); }
        .bg-img-ph img { width: 56px; height: 56px; object-fit: contain; }

        .bg-body { display: flex; flex-direction: column; flex: 1; padding: 12px 14px 14px; gap: 6px; min-width: 0; }
        .bg-tags { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .bg-title { font-family: var(--font-head); font-weight: 500; font-size: 15px; line-height: 1.35; color: var(--ink); margin: 0; overflow-wrap: anywhere; }
        .bg-title a { color: inherit; }
        .bg-title a::after { content: ''; position: absolute; inset: 0; z-index: 1; }
        .bg-title a:hover { color: var(--primary); }
        .bg-title a:focus-visible { outline: none; }
        .bg-excerpt { font-size: 13px; color: var(--text-muted); line-height: 1.6; margin: 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        .bg-meta { font-size: 12px; color: var(--text-muted); margin-top: auto; padding-top: 4px; }

        .bg-empty { max-width: 520px; margin: 20px auto; text-align: center; background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 28px 20px 24px; }
        .bg-empty-ico { display: inline-flex; color: var(--primary); }
      `}</style>
    </div>
  );
}
