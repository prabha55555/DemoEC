import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabase';
import { thumb } from '../utils/thumbnail';
import { fmtDate } from '../utils/orderFormat';
import { usePageMeta } from '../utils/usePageMeta';
import { COMPANY } from '../config/company';
import PageHero from '../components/PageHero';
import { WhatsAppIcon } from '../components/SocialIcons';

// Rendered at /insights/:id (a Blog article). Data comes from the `stories` table.
export default function StoryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [story, setStory] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Filtered server-side, not just hidden after the fact -- otherwise a draft's
    // content is fetched (and briefly present in the response) for anyone with its
    // URL, matching Stories.jsx's own listing query instead of relying solely on
    // the client-side published check below.
    supabase.from('stories').select('*').eq('id', id).eq('published', true).single().then(({ data }) => {
      if (cancelled) return;
      setStory(data || null);
      setLoading(false);
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    return () => { cancelled = true; };
  }, [id]);

  // Called before the early returns below (hooks cannot be conditional); missing fields leave the defaults in place.
  usePageMeta({
    title: story ? story.title : 'Article',
    description: story ? (story.subtitle || String(story.story || '').replace(/\s+/g, ' ').trim().slice(0, 155) || `An article from ${COMPANY.name}.`) : undefined,
    path: `/insights/${id}`,
    image: story?.images?.[0],
  });

  if (loading) {
    return <div style={{ paddingTop: 'var(--hdr-h)', minHeight: '80vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="spinner"></span></div>;
  }

  if (!story || story.published === false) {
    return (
      <div style={{ minHeight: '80vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 'calc(var(--hdr-h) + 40px) 14px 80px' }}>
        <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '32px 24px 28px', maxWidth: 440, width: '100%' }}>
          <span aria-hidden="true" style={{ display: 'inline-flex', color: 'var(--primary)', marginBottom: 10 }}>
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4.5h11a2 2 0 0 1 2 2V19a1.5 1.5 0 0 0 1.5-1.5V9H18" /><path d="M5 4.5V17a2 2 0 0 0 2 2h12" /><path d="M9 9.5l5 5M14 9.5l-5 5" /></svg>
          </span>
          <div style={{ fontFamily: 'var(--font-head)', fontWeight: 500, fontSize: 20, color: 'var(--ink)', marginBottom: 16 }}>Article not found</div>
          <button className="btn btn-gold" onClick={() => navigate('/insights')}>Back to Blog</button>
        </div>
      </div>
    );
  }

  const cover = story.images?.[0];
  const shareHref = `https://wa.me/?text=${encodeURIComponent(`${story.title} — ${window.location.href}`)}`;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <PageHero
        crumbs={[{ label: 'Blog', to: '/insights' }, { label: 'Article' }]}
        title={story.title}
      >
        <div className="ar-meta">
          {story.category && <span className="bl-chip">{story.category}</span>}
          <span>{story.author ? `${story.author} · ` : ''}{fmtDate(story.created_at)}</span>
        </div>
      </PageHero>

      <div className="bl-wrap ar-page">
        <article className="ar-card">
          {cover && (
            <div className="ar-cover">
              <img src={thumb(cover, 1400)} alt={story.title} decoding="async" />
            </div>
          )}
          <div className="ar-in">
            {story.subtitle && <p className="ar-lead">{story.subtitle}</p>}
            <p className="ar-text">
              {story.story}
            </p>
            {story.images?.length > 1 && (
              <div className="ar-gallery">
                {story.images.slice(1).map((img, j) => (
                  <img key={j} src={thumb(img, 600)} alt="" loading="lazy" decoding="async" />
                ))}
              </div>
            )}
            <div className="ar-actions">
              <span className="ar-share-t">Share this article</span>
              <a href={shareHref} target="_blank" rel="noreferrer" className="btn btn-wa btn-sm" style={{ textDecoration: 'none' }}>
                <WhatsAppIcon width="16" height="16" aria-hidden="true" /> WhatsApp
              </a>
              <Link to="/insights" className="btn btn-outline btn-sm ar-back" style={{ textDecoration: 'none' }}>&larr; Back to Blog</Link>
            </div>
          </div>
        </article>
      </div>

      <style>{`
        .ar-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; margin-top: 8px; font-size: 12.5px; color: var(--text-muted); }
        .bl-wrap.ar-page { padding-top: 16px; padding-bottom: 32px; }

        .ar-card { max-width: 720px; margin: 0 auto; background: #fff; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
        .ar-cover { aspect-ratio: 16 / 9; background: #EFF3F2; border-bottom: 1px solid var(--line); }
        .ar-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .ar-in { padding: 20px 16px 18px; }
        @media (min-width: 768px) { .ar-in { padding: 28px 32px 24px; } }
        .ar-lead { font-family: var(--font-head); font-size: 18px; font-weight: 500; color: var(--ink); line-height: 1.55; margin: 0 0 18px; padding-left: 14px; border-left: 3px solid var(--primary); }
        .ar-text { font-size: 16px; color: var(--text); line-height: 1.7; white-space: pre-line; overflow-wrap: anywhere; margin: 0; }
        .ar-gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 24px; }
        @media (min-width: 640px) { .ar-gallery { grid-template-columns: repeat(3, 1fr); } }
        .ar-gallery img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; background: var(--bg-hover); }
        .ar-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 28px; padding-top: 18px; border-top: 1px solid var(--line); }
        .ar-share-t { font-size: 13.5px; font-weight: 500; color: var(--text-muted); margin-right: 4px; }
        .ar-back { margin-left: 0; }
        @media (min-width: 520px) { .ar-back { margin-left: auto; } }
      `}</style>
    </div>
  );
}
