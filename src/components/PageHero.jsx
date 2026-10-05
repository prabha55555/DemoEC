import React from 'react';
import { Link } from 'react-router-dom';

// Shared plain white title bar for content pages: breadcrumb, title and a one-line grey
// subtitle, plus an optional slot (`children`) for a small meta line (e.g. "Last updated").
// Built on the global `.bl-pagehead` -- flat white bar, hairline bottom border, nothing
// floating over it. Page content goes in a `.bl-wrap` right after this component.
//
//   crumb      string -- the current page name ("Home > <crumb>")
//   crumbs     [{ label, to? }] -- full trail after "Home" (the last item has no `to`)
export default function PageHero({ crumb, crumbs, title, subtitle, children }) {
  const trail = crumbs || (crumb ? [{ label: crumb }] : []);
  return (
    <header className="bl-pagehead" style={{ paddingTop: 'var(--hdr-h)', boxSizing: 'content-box' }}>
      <div className="bl-pagehead-inner">
        <nav className="bl-crumbs" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          {trail.map((c) => (
            <React.Fragment key={c.label}>
              <span aria-hidden="true">›</span>
              {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
            </React.Fragment>
          ))}
        </nav>
        <h1 className="ph3-title">{title}</h1>
        {subtitle && <p className="bl-pagehead-sub ph3-sub">{subtitle}</p>}
        {children}
      </div>
      <style>{`
        .ph3-title { font-family: var(--font-head); font-size: clamp(22px, 2.4vw, 26px); line-height: 1.25; letter-spacing: 0; overflow-wrap: anywhere; }
        .ph3-sub { font-size: 14px; line-height: 1.5; margin-top: 4px; max-width: 900px; }
      `}</style>
    </header>
  );
}
