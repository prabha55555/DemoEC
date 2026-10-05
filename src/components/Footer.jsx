import React from 'react';
import { Link } from 'react-router-dom';
import { useBrand } from '../context/BrandContext';
import { COLLECTOR_LABEL, effectiveTaxonomy } from '../data/products';
import { COMPANY } from '../config/company';
import { InstagramIcon, PinterestIcon, FacebookIcon } from './SocialIcons';
import { thumb } from '../utils/thumbnail';
import markImg from '../assets/brightlight-mark.png';

const ic = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

export default function Footer() {
  const { brand } = useBrand();
  const groups = effectiveTaxonomy(brand);

  // Social links are only ever shown when actually configured in Admin -- never fabricated.
  const socials = [
    { label: 'Instagram', href: brand.instagram_url, Icon: InstagramIcon },
    { label: 'Facebook', href: brand.facebook_url, Icon: FacebookIcon },
    { label: 'Pinterest', href: brand.pinterest_url, Icon: PinterestIcon },
  ].filter(s => s.href);

  const useDefaultLockup = !brand.brand_name || brand.brand_name === COMPANY.name;
  const address = brand.registered_office || COMPANY.addressOneLine;

  return (
    <footer className="bl-footer">
      <div className="bl-footer-gold" aria-hidden="true" />
      <div className="bl-footer-grid">

        {/* BRAND + CONTACT */}
        <div className="bl-footer-brand">
          <Link to="/" className="bl-logo" aria-label={`${brand.brand_name || COMPANY.name} — home`} style={{ marginBottom: 14 }}>
            <img className="bl-logo-img" src={brand.logo_url ? thumb(brand.logo_url, 300) : markImg} alt="" style={{ height: 44 }} />
            {useDefaultLockup ? (
              <span className="bl-logo-text">
                <span className="bl-logo-name">Bright<b>light</b></span>
                <span className="bl-logo-sub">SOLUTIONS</span>
              </span>
            ) : <span className="bl-logo-name">{brand.brand_name}</span>}
          </Link>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,.82)', lineHeight: 1.6, maxWidth: 340, marginBottom: 14 }}>
            Your one-stop online store for everyday shopping &mdash; fashion, home, beauty, electronics and more, delivered to your door.
          </p>

          <div className="bl-footer-contact">
            <svg {...ic}><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z" /></svg>
            <a href={`tel:${COMPANY.phoneTel}`}>{COMPANY.phoneDisplay}</a>
          </div>
          <div className="bl-footer-contact">
            <svg {...ic}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 7l-10 6L2 7" /></svg>
            <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>
          </div>
          <div className="bl-footer-contact">
            <svg {...ic}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
            <span>{address}</span>
          </div>
          <div className="bl-footer-contact">
            <svg {...ic}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
            <span>Business hours: {COMPANY.hours}</span>
          </div>

          {socials.length > 0 && (
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              {socials.map(({ label, href, Icon }) => (
                <a key={label} href={href} target="_blank" rel="noreferrer" title={label} aria-label={label} className="bl-social">
                  <Icon width={17} height={17} />
                </a>
              ))}
            </div>
          )}
        </div>

        {/* SHOP */}
        <div>
          <div className="bl-footer-h">Shop</div>
          <Link to="/shop" className="bl-footer-a">All Products</Link>
          {groups.slice(0, 5).map(g => (
            <Link key={g.label} to={`/shop?group=${encodeURIComponent(g.label)}`} className="bl-footer-a">{g.label}</Link>
          ))}
          <Link to={`/shop?collection=${encodeURIComponent(COLLECTOR_LABEL)}`} className="bl-footer-a">{COLLECTOR_LABEL}</Link>
          <Link to="/gift-card" className="bl-footer-a">Gift Cards</Link>
        </div>

        {/* COMPANY */}
        <div>
          <div className="bl-footer-h">Company</div>
          {[['About Us', '/about'], ['Blog', '/insights'], ['Help Centre', '/help'], ['Contact Us', '/contact']].map(([l, p]) => (
            <Link key={l} to={p} className="bl-footer-a">{l}</Link>
          ))}
        </div>

        {/* HELP */}
        <div>
          <div className="bl-footer-h">Customer Help</div>
          {[['My Account', '/account'], ['Track Order', '/account?tab=orders'], ['Shipping Policy', '/shipping-policy'], ['Privacy Policy', '/privacy-policy'], ['Terms & Conditions', '/terms']].map(([l, p]) => (
            <Link key={l} to={p} className="bl-footer-a">{l}</Link>
          ))}
        </div>
      </div>

      <div className="bl-footer-bottom">
        <div className="bl-footer-bottom-in">
          <span>&copy; {new Date().getFullYear()} {brand.brand_name || COMPANY.name}. All rights reserved.</span>
          <span style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[['Terms', '/terms'], ['Privacy', '/privacy-policy'], ['Shipping', '/shipping-policy']].map(([l, p]) => (
              <Link key={l} to={p} className="bl-footer-a" style={{ padding: 0 }}>{l}</Link>
            ))}
          </span>
          <span style={{ fontWeight: 600, color: 'var(--sun)' }}>{COMPANY.tagline}</span>
        </div>
      </div>
    </footer>
  );
}
