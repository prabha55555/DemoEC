import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBrand } from '../context/BrandContext';
import { useCartActions } from '../context/CartContext';
import { usePageMeta } from '../utils/usePageMeta';
import { COMPANY } from '../config/company';
import { formatMoney as fmt } from '../utils/catalog';
import { DEFAULT_GIFTCARD_MIN, giftcardMaxOf } from '../utils/pricing';
import PageHero from '../components/PageHero';
import markImg from '../assets/brightlight-mark.png';
import toast from 'react-hot-toast';

const PRESETS = [1000, 2500, 5000, 10000];

export default function GiftCard() {
  const { brand } = useBrand();
  const { addToCart } = useCartActions();
  const navigate = useNavigate();
  usePageMeta({ title: 'Gift Cards', description: `Give the gift of choice with a ${COMPANY.name} gift card. Pick an amount and let them choose what they love.`, path: '/gift-card' });
  const [amount, setAmount] = useState(2500);
  const [custom, setCustom] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message, setMessage] = useState('');
  const addedRef = useRef(false);

  // ?? (not ||) so an admin who explicitly sets a min of 0 isn't silently overridden
  // back to the default -- 0 is a deliberate, valid configuration, not "unset".
  const min = brand.giftcard_min ?? DEFAULT_GIFTCARD_MIN;
  const max = giftcardMaxOf(brand.giftcard_max); // Infinity when the admin hasn't set a cap
  const activeAmount = custom ? Number(custom) : amount;
  const valid = Number.isInteger(activeAmount) && activeAmount >= min && activeAmount <= max;
  const visiblePresets = PRESETS.filter(v => v >= min && v <= max);
  const validityMonths = Number(brand.gift_card_validity_months) || 0;

  function selectPreset(v) {
    setAmount(v);
    setCustom('');
  }

  function handleAddToCart() {
    if (addedRef.current) return; // a fast double-tap must not add two gift-card lines
    if (!valid) {
      toast.error(Number.isInteger(activeAmount)
        ? (Number.isFinite(max) ? `Please enter an amount between ${fmt(min)} and ${fmt(max)}.` : `Please enter an amount of at least ${fmt(min)}.`)
        : 'Please enter a whole number amount (no paise/decimals).');
      return;
    }
    if (!recipientName.trim() || !recipientEmail.trim()) {
      toast.error("Please enter the recipient's name and email.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim())) {
      toast.error("Please enter a valid recipient email address.");
      return;
    }
    addedRef.current = true;
    addToCart({
      id: 'giftcard-' + Date.now(),
      name: `Gift Card (${fmt(activeAmount)})`,
      cat: 'Gift Card',
      price: activeAmount,
      // A gift-card cart line is one purchasable card -- capping stock at 1 keeps the cart's
      // qty stepper from letting someone "buy 2" (which would charge for two but only ever
      // create one redeemable balance). The redeemable code itself is generated server-side
      // after payment (src/utils/orderWrite.js -> issueGiftCards), never in the browser.
      stock: 1,
      isGiftCard: true,
      recipientName: recipientName.trim(),
      recipientEmail: recipientEmail.trim(),
      giftMessage: message.trim(),
    });
    toast.success('Gift card added to cart.');
    navigate('/cart');
  }

  if (brand.giftcard_enabled === false) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
        <PageHero crumb="Gift cards" title="Gift Cards" />
        <div className="bl-wrap" style={{ paddingTop: 16, paddingBottom: 40 }}>
          <div style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center', background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '28px 20px' }}>
            <span aria-hidden="true" style={{ display: 'inline-flex', color: 'var(--primary)', marginBottom: 10 }}>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="8.5" width="17" height="11" rx="2.5" /><path d="M3.5 12.5h17M12 8.5v11M12 8.5c-1.2-3.4-5.2-3.6-5.2-1.2 0 1.4 2.2 1.2 5.2 1.2zM12 8.5c1.2-3.4 5.2-3.6 5.2-1.2 0 1.4-2.2 1.2-5.2 1.2z" /></svg>
            </span>
            <p style={{ fontSize: 15, color: 'var(--text-muted)', lineHeight: 1.7 }}>
              Gift cards aren't available right now — check back soon.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const steps = [
    ['Pick an amount', 'Choose a preset or enter an amount of your own.'],
    ['Tell us who it is for', "Add the recipient's name, email and an optional personal message."],
    ['Pay and share the code', 'Once your order is placed, the gift card code appears in your order and under Account → Gift cards. Share it with the recipient, along with your message.'],
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <PageHero
        crumb="Gift cards"
        title="Gift Cards"
        subtitle="Give the gift of choice — pick an amount and let them choose exactly what they love."
      />

      <section className="bl-wrap gc-page">
        <div className="gc-grid">

          {/* GIFT CARD VISUAL (live preview of the amount and recipient) */}
          <div className="gc-visual">
            <div className="gc-card" aria-hidden="true">
              <div className="gc-top">
                <span className="gc-mark"><img src={markImg} alt="" width="30" height="30" /></span>
                <span className="gc-kind">Gift card</span>
              </div>
              <div className="gc-bottom">
                <div>
                  <div className="gc-lbl">Value</div>
                  <div className="gc-amt">{fmt(activeAmount || 0)}</div>
                </div>
                <div className="gc-to">
                  {recipientName.trim() ? (<><span>For</span><b>{recipientName.trim()}</b></>) : <b>{COMPANY.shortName}</b>}
                </div>
              </div>
            </div>
          </div>

          {/* FORM */}
          <div className="gc-form">
            <div className="gc-sh"><span className="gc-sn">1</span>Choose an amount</div>

            <div className="gc-preset-grid">
              {visiblePresets.map(v => {
                const on = !custom && amount === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => selectPreset(v)}
                    aria-pressed={on}
                    className={`gc-preset${on ? ' is-on' : ''}`}
                  >{fmt(v)}</button>
                );
              })}
            </div>

            <label htmlFor="gc-custom" className="form-label">Or enter a custom amount</label>
            <div className="gc-money">
              <span className="gc-rs" aria-hidden="true">₹</span>
              <input
                id="gc-custom"
                type="number"
                className="form-input"
                // Reflects whichever preset tile is active (not just what was typed here
                // directly) -- otherwise picking "Rs. 5,000" above highlighted that tile
                // but left this box looking empty, reading as if nothing was selected.
                // Typing here still overrides it via onChange same as before.
                value={custom || (amount ? String(amount) : '')}
                onChange={e => setCustom(e.target.value)}
                onWheel={e => e.currentTarget.blur()}
                placeholder={Number.isFinite(max) ? `Between ${fmt(min)} and ${fmt(max)}` : `${fmt(min)} or more`}
              />
            </div>
            <div className="gc-hint">
              {Number.isFinite(max) ? `Between ${fmt(min)} and ${fmt(max)}` : `${fmt(min)} or more`}, whole rupees only.
            </div>

            <div className="gc-sep" />

            <div className="gc-sh"><span className="gc-sn">2</span>Who is it for?</div>
            <div className="gc-two">
              <div className="form-group">
                <label htmlFor="gc-name" className="form-label">Recipient's name</label>
                <input id="gc-name" className="form-input" value={recipientName} onChange={e => setRecipientName(e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="gc-email" className="form-label">Recipient's email</label>
                <input id="gc-email" type="email" className="form-input" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="gc-msg" className="form-label">Personal message (optional)</label>
              <textarea id="gc-msg" className="form-textarea" value={message} onChange={e => setMessage(e.target.value)} rows={3} style={{ resize: 'vertical', lineHeight: 1.6 }} />
            </div>
            <div className="gc-note">
              After payment, the gift card code is shown in your order so you can share it with {recipientName || 'the recipient'}. {validityMonths > 0 ? `Gift cards are valid for ${validityMonths} months from purchase.` : ''}
            </div>

            <div className="gc-total">
              <span>Total</span>
              <span className="gc-total-n">{fmt(activeAmount || 0)}</span>
            </div>

            <button type="button" className="btn btn-gold btn-full gc-cta" onClick={handleAddToCart}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8h12l-1 11.5a1.5 1.5 0 0 1-1.5 1.4h-7A1.5 1.5 0 0 1 7 19.5L6 8z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></svg>
              Add gift card to cart
            </button>
          </div>

          {/* HOW IT WORKS */}
          <div className="gc-how">
            {brand.giftcard_description && (
              <p className="gc-desc">{brand.giftcard_description}</p>
            )}
            <h2 className="gc-how-h">How it works</h2>
            <ol className="gc-how-list">
              {steps.map(([t, d], i) => (
                <li key={t}>
                  <span className="gc-how-n" aria-hidden="true">{i + 1}</span>
                  <span><b>{t}</b><span className="gc-how-d">{d}</span></span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <style>{`
        .bl-wrap.gc-page { padding-top: 16px; padding-bottom: 32px; }
        .gc-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; }
        @media (min-width: 900px) {
          .gc-grid { grid-template-columns: minmax(0, 4fr) minmax(0, 7fr); grid-template-rows: auto 1fr; grid-template-areas: "visual form" "how form"; gap: 14px 20px; align-items: start; }
          .gc-visual { grid-area: visual; } .gc-form { grid-area: form; } .gc-how { grid-area: how; }
        }

        /* gift card preview: flat teal card */
        .gc-card { aspect-ratio: 1.62 / 1; max-width: 480px; border-radius: 8px; background: var(--primary); color: #fff; padding: clamp(16px, 3vw, 22px); display: flex; flex-direction: column; justify-content: space-between; }
        .gc-top, .gc-bottom { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .gc-bottom { align-items: flex-end; }
        .gc-mark { width: 44px; height: 44px; border-radius: 6px; background: #fff; display: flex; align-items: center; justify-content: center; }
        .gc-mark img { width: 30px; height: 30px; object-fit: contain; }
        .gc-kind { font-weight: 500; font-size: 13px; color: rgba(255,255,255,.92); padding-top: 2px; }
        .gc-lbl { font-size: 12px; color: rgba(255,255,255,.8); margin-bottom: 2px; }
        .gc-amt { font-family: var(--font-head); font-weight: 600; font-size: clamp(28px, 6vw, 40px); line-height: 1.1; overflow-wrap: anywhere; }
        .gc-to { display: flex; flex-direction: column; align-items: flex-end; text-align: right; font-size: 12px; color: rgba(255,255,255,.8); min-width: 0; max-width: 46%; }
        .gc-to b { font-weight: 500; font-size: 14px; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }

        /* how it works */
        .gc-how { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 16px; min-width: 0; }
        .gc-desc { font-size: 14px; color: var(--text); line-height: 1.65; background: var(--primary-tint); border: 1px solid var(--primary-border); border-radius: 6px; padding: 10px 14px; margin: 0 0 14px; }
        .gc-how-h { font-family: var(--font-head); font-weight: 500; font-size: 18px; color: var(--ink); margin: 0 0 6px; }
        .gc-how-list { list-style: none; margin: 0; padding: 0; }
        .gc-how-list li { display: flex; gap: 10px; align-items: flex-start; padding: 10px 0; }
        .gc-how-list li + li { border-top: 1px solid var(--line); }
        .gc-how-n { flex-shrink: 0; min-width: 14px; color: var(--primary); font-weight: 600; font-size: 14px; line-height: 1.4; }
        .gc-how-n::after { content: '.'; }
        .gc-how-list b { display: block; font-weight: 600; font-size: 14px; color: var(--ink); margin-bottom: 1px; }
        .gc-how-d { display: block; font-size: 13px; color: var(--text-muted); line-height: 1.55; }

        /* form card */
        .gc-form { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 18px 16px 18px; min-width: 0; }
        @media (min-width: 768px) { .gc-form { padding: 24px 24px 22px; } }
        .gc-sh { display: flex; align-items: baseline; gap: 6px; font-family: var(--font-head); font-weight: 500; font-size: 16px; color: var(--ink); margin-bottom: 12px; }
        .gc-sn { color: var(--primary); font-weight: 600; }
        .gc-sn::after { content: '.'; }
        .gc-preset-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
        @media (max-width: 480px) { .gc-preset-grid { grid-template-columns: 1fr 1fr; } }
        .gc-preset { min-height: 44px; padding: 10px 8px; font-family: var(--font-body); font-weight: 500; font-size: 14.5px; border: 1px solid #CDD6D4; border-radius: 6px; background: #fff; color: var(--ink); transition: background .12s, border-color .12s, color .12s; }
        .gc-preset:hover { border-color: var(--primary); color: var(--primary); }
        .gc-preset.is-on { background: var(--primary-tint); border-color: var(--primary); box-shadow: inset 0 0 0 1px var(--primary); color: var(--primary); font-weight: 600; }
        .gc-money { position: relative; }
        .gc-rs { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); font-weight: 500; font-size: 15px; color: var(--text-muted); pointer-events: none; }
        .gc-money .form-input { padding-left: 30px; font-size: 15px; font-weight: 500; }
        .gc-hint { font-size: 12.5px; color: var(--text-muted); margin-top: 6px; }
        .gc-sep { height: 1px; background: var(--border); margin: 20px 0 18px; }
        .gc-two { display: grid; grid-template-columns: 1fr; gap: 0 14px; }
        @media (min-width: 640px) { .gc-two { grid-template-columns: 1fr 1fr; } }
        .gc-note { font-size: 13px; color: var(--text-muted); line-height: 1.6; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; }
        .gc-total { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 18px 0 14px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 14px; font-weight: 500; color: var(--text-muted); }
        .gc-total-n { font-family: var(--font-head); font-size: 22px; font-weight: 600; color: var(--ink); }
        .gc-cta { min-height: 46px; }
      `}</style>
    </div>
  );
}
