import { useEffect } from 'react';
import { COMPANY } from '../config/company';

const SITE_URL = COMPANY.website;
const DEFAULT_TITLE = COMPANY.name;

function upsertMeta(attr, key, content) {
  if (!content) return null;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
  return el;
}

function upsertCanonical(href) {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
  return el;
}

// Sets the browser tab title + meta description/OG/Twitter/canonical tags for
// the current page, and restores the previous ones on unmount so navigating
// away (React Router, no full page reload) doesn't leave a stale title/tag
// behind on whatever page renders next.
//
// This only helps crawlers that execute JavaScript (Google's does) -- it does
// NOT help WhatsApp/Facebook/Twitter/Slack link-preview crawlers, which don't
// run JS and only ever see index.html's static tags. That's a known, accepted
// limitation of this SPA with no server-side rendering; api/product-share.js
// is the deliberate workaround for sharing a product link with a preview card,
// and isn't something this hook can or should replace.
export function usePageMeta({ title, description, path, image }) {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title ? `${title} | ${DEFAULT_TITLE}` : DEFAULT_TITLE;

    const descEl = upsertMeta('name', 'description', description);
    const ogTitleEl = upsertMeta('property', 'og:title', title || DEFAULT_TITLE);
    const ogDescEl = upsertMeta('property', 'og:description', description);
    const ogUrlEl = path ? upsertMeta('property', 'og:url', `${SITE_URL}${path}`) : null;
    const ogImageEl = upsertMeta('property', 'og:image', image);
    const twitterTitleEl = upsertMeta('name', 'twitter:title', title || DEFAULT_TITLE);
    const twitterDescEl = upsertMeta('name', 'twitter:description', description);
    const canonicalEl = path ? upsertCanonical(`${SITE_URL}${path}`) : null;

    return () => {
      document.title = prevTitle;
      // Elements are left in place (harmless -- the next page's own call
      // overwrites their content immediately) except canonical, which must
      // not silently keep pointing at a page the customer already left.
      if (canonicalEl) canonicalEl.remove();
      void descEl; void ogTitleEl; void ogDescEl; void ogUrlEl; void ogImageEl; void twitterTitleEl; void twitterDescEl;
    };
  }, [title, description, path, image]);
}
