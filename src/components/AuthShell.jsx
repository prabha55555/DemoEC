import React from 'react';
import { Link } from 'react-router-dom';
import mark from '../assets/brightlight-mark.png';

// Shared presentation for the sign-in / register / reset-password / admin-login pages.
// Marketplace-style (Meesho / Flipkart) login: a light-grey page with ONE centred white bordered card --
// logo, title, subtitle, the page's own form, a footer link row and a small trust line. No brand panel.
// `bare` is the admin treatment (those routes have no site header): same card with a small "Admin" label
// under the logo, vertically centred on the page.
// Props kept for backwards compatibility: `eyebrow`, `heading`, `blurb` and `perks` belonged to the old
// split-screen brand panel; they are accepted and ignored.
// Purely visual -- every handler, field id/name and validation stays in the page itself.
// The page content uses the `au-*` classes defined in the <style> block below.

// Small stroke icons the auth pages reuse inside inputs.
const ICONS = {
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 8l9 6 9-6" /></>,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1" /></>,
  phone: <><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M11 18h2" /></>,
};

export function AuIcon({ name, size = 16, className = 'au-ico' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export default function AuthShell({
  title, subtitle, children, footer, bare = false, trust = 'Secure sign-in. We never share your details.',
}) {
  return (
    <div className={`au-page${bare ? ' au-bare au-admin' : ''}`}>
      <div className="au-wrap">
        <div className="au-card">
          <Link to="/" className="au-logo" aria-label="Brightlight Solutions home">
            <img src={mark} alt="" width="36" height="36" />
            <span className="au-logo-text">
              <span className="bl-logo-name">Bright<b>light</b></span>
              <span className="bl-logo-sub">SOLUTIONS</span>
            </span>
          </Link>
          {bare && <span className="au-admin-tag">Admin</span>}

          <h1 className="au-title">{title}</h1>
          {subtitle && <p className="au-sub">{subtitle}</p>}
          {children}

          {footer && <div className="au-foot">{footer}</div>}
        </div>

        {trust && (
          <div className="au-trust">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
            <span>{trust}</span>
          </div>
        )}
      </div>

      <style>{`
        /* ── page: grey background, one centred card ───────────── */
        .au-page { min-height: 100vh; background: var(--bg); padding: calc(var(--hdr-h) + 20px) 14px 40px; }
        .au-page.au-bare { padding: 24px 14px; display: flex; align-items: center; justify-content: center; }
        .au-wrap { width: 100%; max-width: 420px; margin: 0 auto; }
        .au-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 28px; }
        @media (min-width: 900px) { .au-page:not(.au-bare) { padding-top: calc(var(--hdr-h) + 36px); } }
        @media (max-width: 380px) { .au-card { padding: 22px 18px; } }

        /* ── logo (mark + wordmark, no chip) ───────────────────── */
        .au-logo { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 18px; }
        .au-logo img { height: 36px; width: auto; object-fit: contain; flex-shrink: 0; }
        .au-logo-text { display: flex; flex-direction: column; line-height: 1; }
        .au-logo .bl-logo-name { font-size: 20px; }
        .au-admin .au-logo { display: flex; width: fit-content; margin-bottom: 10px; }
        .au-admin-tag { display: block; width: fit-content; margin: 0 0 18px; padding: 2px 8px; border-radius: 4px; background: var(--ink); color: #fff; font-size: 11px; font-weight: 600; line-height: 1.5; }

        /* ── heading ───────────────────────────────────────────── */
        .au-title { font-family: var(--font-head); font-weight: 500; font-size: 22px; line-height: 1.25; color: var(--text); margin: 0; }
        .au-sub { font-size: 14px; color: var(--text-muted); line-height: 1.5; margin: 4px 0 20px; }
        .au-title + .au-seg, .au-title + form, .au-title + .au-alert, .au-title + .au-google { margin-top: 20px; }

        /* ── fields: 42px boxed inputs ─────────────────────────── */
        .au-field { margin-bottom: 14px; }
        .au-label { display: block; font-size: 13px; font-weight: 500; color: var(--text); margin-bottom: 6px; }
        .au-inwrap { position: relative; }
        .au-inwrap .au-ico { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #8A9694; pointer-events: none; }
        .au-input { width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid #CDD6D4; border-radius: 6px; background: #fff;
          font-family: var(--font-body); font-size: 16px; color: var(--text); outline: none; caret-color: var(--primary);
          transition: border-color .15s, box-shadow .15s; }
        .au-inwrap .au-input { padding-left: 36px; }
        .au-input::placeholder { color: #8A9694; }
        .au-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(15,118,110,.12); }
        .au-input[aria-invalid="true"] { border-color: var(--error); }
        .au-input[aria-invalid="true"]:focus { box-shadow: 0 0 0 3px rgba(192,53,43,.14); }
        .au-fielderr { font-size: 12.5px; color: var(--error); margin-top: 4px; line-height: 1.4; }
        .au-grid { display: grid; grid-template-columns: minmax(0,1fr); gap: 0; }
        @media (min-width: 640px) {
          .au-input { min-height: 42px; font-size: 14px; }
        }

        /* ── notices ───────────────────────────────────────────── */
        .au-alert { background: #FDEBE9; border: 1px solid #F6C9C4; border-radius: 6px; padding: 10px 12px; margin-bottom: 16px; font-size: 13.5px; line-height: 1.5; color: var(--error); }
        .au-ok { background: #E5F6EE; border: 1px solid #BDE6D2; border-radius: 6px; padding: 10px 12px; margin-bottom: 16px; font-size: 13.5px; line-height: 1.5; color: var(--success); }
        .au-note { background: var(--sun-tint); border: 1px solid var(--gold-border); border-radius: 6px; padding: 10px 12px; margin-bottom: 16px; font-size: 13.5px; line-height: 1.5; color: var(--sun-text); }
        .au-found { border: 1px dashed var(--primary-border); border-radius: 6px; background: var(--primary-tint); padding: 10px 12px; margin-bottom: 14px; }
        .au-found small { display: block; font-size: 12px; font-weight: 500; color: var(--text-muted); margin-bottom: 2px; }
        .au-found div { font-size: 14px; font-weight: 600; color: var(--ink); word-break: break-all; }
        .au-hint { font-size: 13.5px; line-height: 1.55; color: var(--text-muted); margin: 0 0 16px; }

        /* ── buttons ───────────────────────────────────────────── */
        .au-primary { min-height: 44px; font-size: 14px; border-radius: 6px; box-shadow: none; }
        .au-google { width: 100%; min-height: 44px; display: flex; align-items: center; justify-content: center; gap: 10px; border: 1px solid #CDD6D4; border-radius: 6px;
          background: #fff; color: var(--text); font-size: 14px; font-weight: 600; transition: border-color .15s, background .15s; }
        .au-google:hover:not(:disabled) { border-color: var(--primary); background: var(--primary-tint); }
        .au-google:disabled { opacity: .6; cursor: not-allowed; }
        .au-or { display: flex; align-items: center; gap: 12px; margin: 16px 0; font-size: 12.5px; font-weight: 400; color: var(--text-muted); }
        .au-or::before, .au-or::after { content: ''; flex: 1; height: 1px; background: var(--border); }

        /* ── Email / Mobile Number: simple underline tabs ──────── */
        .au-seg { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 18px; }
        .au-seg button { flex: 1; min-width: 0; min-height: 42px; padding: 8px 10px; margin-bottom: -1px; border: none; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: var(--text-muted);
          font-size: 14px; font-weight: 500; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: color .15s, border-color .15s; }
        .au-seg button:hover { color: var(--text); }
        .au-seg button[aria-selected="true"] { color: var(--primary); border-bottom-color: var(--primary); font-weight: 600; }

        /* ── links, checkboxes, footer ─────────────────────────── */
        .au-linkbtn { background: none; border: none; padding: 6px 0; font-size: 13.5px; font-weight: 500; color: var(--primary); text-align: center; }
        .au-linkbtn:hover { text-decoration: underline; }
        .au-row { display: flex; justify-content: flex-end; margin: -4px 0 12px; }
        .au-check { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; font-size: 13px; line-height: 1.55; color: var(--text-muted); }
        .au-check input { margin-top: 2px; width: 16px; height: 16px; flex-shrink: 0; accent-color: var(--primary); cursor: pointer; }
        .au-check a { color: var(--primary); font-weight: 500; text-decoration: underline; }
        .au-foot { text-align: center; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 13.5px; color: var(--text-muted); }
        .au-foot a { color: var(--primary); font-weight: 600; }
        .au-foot a:hover { text-decoration: underline; }
        .au-trust { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 14px; font-size: 12px; color: var(--text-muted); text-align: center; }
        .au-trust svg { color: var(--primary); flex-shrink: 0; }
      `}</style>
    </div>
  );
}
