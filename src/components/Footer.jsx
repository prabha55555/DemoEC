import React from 'react';
import { Link } from 'react-router-dom';
import { useBrand } from '../context/BrandContext';
import { useCatalog } from '../context/CatalogContext';
import { COMPANY } from '../config/company';
import { InstagramIcon, FacebookIcon, YouTubeIcon, PinterestIcon } from './SocialIcons';
import { thumb } from '../utils/thumbnail';
import { DEALS_PATH } from '../utils/shopQuery';
import { safeHref } from '../utils/safeUrl';
import markImg from '../assets/brightlight-mark.png';

const ic = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

export default function Footer() {
  const { brand } = useBrand();
  const { tree } = useCatalog();

  // Social links are only ever shown when actually configured in Admin -- never fabricated.
  const socials = [
    { label: 'Instagram', href: safeHref(brand.instagram_url), Icon: InstagramIcon },
    { label: 'Facebook', href: safeHref(brand.facebook_url), Icon: FacebookIcon },
    { label: 'YouTube', href: safeHref(brand.youtube_url), Icon: YouTubeIcon },
    { label: 'Pinterest', href: safeHref(brand.pinterest_url), Icon: PinterestIcon },
  ].filter(s => s.href);

  const name = brand.brand_name || COMPANY.name;
  const useDefaultLockup = !brand.brand_name || brand.brand_name === COMPANY.name;
  const address = brand.registered_office || COMPANY.addressOneLine;
  const phone = brand.support_phone || COMPANY.phoneDisplay;
  const tel = (brand.support_phone || COMPANY.phoneTel).replace(/[^\d+]/g, '');
  const email = brand.support_email || COMPANY.email;
  const seller = brand.seller_legal_name || COMPANY.name;
  const payments = ['UPI', 'Debit & credit cards', 'Net banking', ...(brand.cod_enabled ? ['Cash on delivery'] : [])];

  return (
    <footer className="bl-footer">
      <div className="bl-footer-grid">

        {/* BRAND + CONTACT */}
        <div className="bl-footer-brand">
          <Link to="/" className="bl-logo" aria-label={`${name} — home`} style={{ marginBottom: 14 }}>
            <img className="bl-logo-img" src={brand.logo_url ? thumb(brand.logo_url, 300) : markImg} alt="" style={{ height: 44 }} />
            {useDefaultLockup ? (
              <span className="bl-logo-text">
                <span className="bl-logo-name">Bright<b>light</b></span>
                <span className="bl-logo-sub">SOLUTIONS</span>
              </span>
            ) : <span className="bl-logo-name">{brand.brand_name}</span>}
          </Link>
          <p className="bl-footer-about">
            {COMPANY.shortName} brings fashion, home, beauty, electronics and much more together in one place, with secure payments and easy returns.
          </p>

          <div className="bl-footer-contact">
            <svg {...ic}><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z" /></svg>
            <a href={`tel:${tel}`}>{phone}</a>
          </div>
          <div className="bl-footer-contact">
            <svg {...ic}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 7l-10 6L2 7" /></svg>
            <a href={`mailto:${email}`}>{email}</a>
          </div>
          <div className="bl-footer-contact">
            <svg {...ic}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
            <span>Customer support: {COMPANY.hours}</span>
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
        <nav aria-label="Shop">
          <div className="bl-footer-h">Shop</div>
          <Link to="/shop" className="bl-footer-a">All products</Link>
          <Link to={DEALS_PATH} className="bl-footer-a">Deals</Link>
          {tree.slice(0, 5).map(root => <Link key={root.id} to={`/category/${root.slug}`} className="bl-footer-a">{root.name}</Link>)}
          <Link to="/gift-card" className="bl-footer-a">Gift cards</Link>
        </nav>

        {/* COMPANY */}
        <nav aria-label="Company">
          <div className="bl-footer-h">Company</div>
          {[['About us', '/about'], ['Blog', '/insights'], ['Help Centre', '/help'], ['Contact us', '/contact']].map(([l, p]) => (
            <Link key={l} to={p} className="bl-footer-a">{l}</Link>
          ))}
        </nav>

        {/* HELP */}
        <nav aria-label="Customer help">
          <div className="bl-footer-h">Customer help</div>
          {[['My account', '/account'], ['Track your order', '/account?tab=orders'], ['Shipping policy', '/shipping-policy'], ['Returns & refunds', '/returns-policy'], ['Terms & conditions', '/terms'], ['Privacy policy', '/privacy-policy']].map(([l, p]) => (
            <Link key={l} to={p} className="bl-footer-a">{l}</Link>
          ))}
        </nav>
      </div>

      <div className="bl-footer-pay">
        <span>We accept</span>
        {payments.map(p => <span key={p} className="bl-footer-paychip">{p}</span>)}
        <span className="bl-footer-secure">Payments are processed securely online</span>
      </div>

      <div className="bl-footer-bottom">
        <div className="bl-footer-bottom-in">
          <span>&copy; {new Date().getFullYear()} {name}. All rights reserved.</span>
          <span className="bl-footer-legal">
            Sold by {seller}{brand.seller_gstin ? ` · GSTIN ${brand.seller_gstin}` : ''} · {address}
          </span>
          <span style={{ fontWeight: 600, color: 'var(--sun)' }}>{COMPANY.tagline}</span>
        </div>
      </div>
    </footer>
  );
}
