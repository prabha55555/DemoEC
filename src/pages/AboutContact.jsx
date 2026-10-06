import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../context/AuthContext';
import { useBrand } from '../context/BrandContext';
import { recordWhatsAppEnquiry } from '../utils/enquiryBeacon';
import VideoPlayer from '../components/VideoPlayer';
import { PhoneIcon, EmailIcon, WhatsAppIcon, PinIcon, ClockIcon, GlobeIcon } from '../components/SocialIcons';
import toast from 'react-hot-toast';
import { thumb } from '../utils/thumbnail';
import { usePageMeta } from '../utils/usePageMeta';
import { COMPANY, DEFAULT_WA_MESSAGE, whatsappLink } from '../config/company';
import { shippingPromise } from '../utils/storeCopy';
import PageHero from '../components/PageHero';

// Photo + video as a 2-slide carousel for the About page side panel -- swipe on
// mobile, arrow/dot buttons on desktop. Both slides share one fixed aspect-ratio
// frame (unlike a lone photo, which sizes itself to its own natural shape) since a
// sliding carousel needs consistent dimensions across slides to animate cleanly.
function AboutMediaSlider({ image, video }) {
  const [idx, setIdx] = useState(0);
  const touchX = useRef(null);
  const videoRef = useRef(null);
  // True from the first moment the visitor manually changes slides (an arrow,
  // a dot, or a swipe) -- from then on ALL automatic transitions stop for
  // good, and idx only ever changes by the visitor's own next action. Before
  // that point, the slider runs itself: photo for 3s, then the video, which
  // plays through and returns to the photo on its own once it actually ends.
  const userControlledRef = useRef(false);
  function goTo(i) {
    userControlledRef.current = true;
    setIdx(i);
  }
  // Auto-advance, both directions -- only while userControlledRef is false.
  // The video's own 'ended' event is what advances back to the photo, not a
  // fixed timer: a flat timeout here previously cut off any real video
  // longer than that timeout while it was still genuinely playing, which is
  // exactly the bug this replaced. The only timer-based fallback left is
  // 'error' -- a video that fails to load/decode fires that event almost
  // immediately and never fires 'ended' on its own, so without this the
  // slider could get stuck on a broken video forever; a real, successfully
  // playing video -- however long -- never fires 'error' at all.
  useEffect(() => {
    const v = videoRef.current;
    if (idx !== 1) {
      v?.pause();
      if (userControlledRef.current) return;
      const t = setTimeout(() => setIdx(1), 3000);
      return () => clearTimeout(t);
    }
    if (v) { v.currentTime = 0; v.play().catch(() => {}); }
    if (userControlledRef.current) return;
    const handleEnded = () => setIdx(0);
    const handleError = () => setIdx(0);
    v?.addEventListener('ended', handleEnded);
    v?.addEventListener('error', handleError);
    return () => { v?.removeEventListener('ended', handleEnded); v?.removeEventListener('error', handleError); };
  }, [idx]);
  function onTouchStart(e) { touchX.current = e.touches[0].clientX; }
  function onTouchEnd(e) {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) goTo(dx < 0 ? Math.min(idx + 1, 1) : Math.max(idx - 1, 0));
    touchX.current = null;
  }
  const arrowBtn = (side, show) => ({
    position:'absolute', [side]:10, top:'50%', transform:'translateY(-50%)',
    width:38, height:38, borderRadius:'50%', border:'1px solid var(--border)', cursor:'pointer',
    background:'#fff', color:'var(--ink)', fontSize:22, lineHeight:0,
    display: show ? 'flex' : 'none', alignItems:'center', justifyContent:'center', zIndex:2,
  });
  return (
    <>
      <div
        style={{ position:'relative', overflow:'hidden', aspectRatio:'4/5', background:'var(--primary-deep)' }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div style={{ display:'flex', width:'100%', height:'100%', transform:`translateX(-${idx * 100}%)`, transition:'transform .35s ease' }}>
          <div style={{ minWidth:'100%', height:'100%' }}>
            <img src={thumb(image, 1000)} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
          </div>
          <div style={{ minWidth:'100%', height:'100%', display:'flex', alignItems:'center' }}>
            <video ref={videoRef} src={video} muted autoPlay playsInline controls={idx === 1} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
          </div>
        </div>
        <button aria-label="Show photo" onClick={() => goTo(0)} style={arrowBtn('left', idx === 1)}>‹</button>
        <button aria-label="Show video" onClick={() => goTo(1)} style={arrowBtn('right', idx === 0)}>›</button>
        <div style={{ position:'absolute', bottom:2, left:'50%', transform:'translateX(-50%)', display:'flex', zIndex:2 }}>
          {/* Visible dot stays a compact 7px indicator -- the button itself is
              sized to a real ~40px touch target so the tap area doesn't force
              the dot itself to balloon out of scale with this small slider. */}
          {[0, 1].map(i => (
            <button key={i} onClick={() => goTo(i)} aria-label={i === 0 ? 'Photo' : 'Video'} style={{ width:40, height:40, padding:0, border:'none', background:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <span aria-hidden="true" style={{ width:7, height:7, borderRadius:'50%', background: idx === i ? 'var(--sun)' : 'rgba(255,255,255,.6)', boxShadow:'0 1px 3px rgba(0,0,0,.35)' }} />
            </button>
          ))}
        </div>
      </div>
      <div style={{ textAlign:'center', padding:'8px 8px 10px', background:'#fff', fontFamily:"var(--font-body)", fontWeight:400, fontSize:12.5, color:'var(--text-muted)' }}>
        {idx === 0 ? 'Swipe or tap for the video' : 'Back to photo'}
      </div>
    </>
  );
}

// ── ABOUT ───────────────────────────────────────────────────
export function About() {
  const navigate = useNavigate();
  const { brand } = useBrand();
  usePageMeta({
    title: 'About Us',
    description: `${COMPANY.name} — your online store for everyday shopping, based in Tiruppur, Tamil Nadu.`,
    path: '/about',
  });

  const values = [
    ['Easy shopping', 'Browse a wide range of products across categories, search and filter quickly, and order in a few taps.',
      <><path d="M6 8h12l-1 11.5a1.5 1.5 0 0 1-1.5 1.4h-7A1.5 1.5 0 0 1 7 19.5L6 8z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></>],
    ['Secure checkout', 'Pay safely online and track your orders from your account, from checkout to delivery.',
      <><path d="M12 3l7.5 3v5.4c0 4.6-3.1 8.4-7.5 9.6-4.4-1.2-7.5-5-7.5-9.6V6L12 3z" /><path d="M8.6 12.2l2.5 2.5 4.4-4.9" /></>],
    ['Friendly support', 'Questions about a product or an order? Reach us any time by call, WhatsApp or email.',
      <><path d="M20.5 11.5a8 8 0 0 1-11.8 7L3.5 20l1.6-4.6A8 8 0 1 1 20.5 11.5z" /><path d="M8.8 10.2h6.4M8.8 13.4h4" /></>],
  ];

  // Quick facts shown under the story (all taken from the story copy itself).
  const facts = [
    [shippingPromise(brand), <><path d="M3 7.5h11v8.5H3zM14 10.5h4l3 3v2.5h-7z" /><circle cx="7.5" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>],
    ['Secure online payments', <><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>],
    [`Support ${COMPANY.hours.toLowerCase()}`, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></>],
  ];

  // Optional admin-set media (photo and/or video) shown beside the story; nothing when none is set.
  const media = brand.about_image && brand.about_video ? (
    <AboutMediaSlider image={brand.about_image} video={brand.about_video} />
  ) : brand.about_video ? (
    <VideoPlayer src={brand.about_video} caption={brand.about_video_caption} />
  ) : brand.about_image ? (
    <img src={thumb(brand.about_image, 1000)} alt={`About ${COMPANY.name}`} style={{ width:'100%', height:'auto', display:'block' }} />
  ) : null;

  return (
    <div style={{ background:'var(--bg)', minHeight:'100vh' }}>
      <PageHero crumb="About us" title={`About ${COMPANY.name}`} subtitle="Your online store for everyday shopping" />

      <div className="bl-wrap ab-page">
        {/* STORY */}
        <section className={`ab-story${media ? ' has-media' : ''}`}>
          {media && <div className="ab-media"><div className="ab-frame">{media}</div></div>}
          <div className="ab-body">
            <p className="ab-kicker">Who we are</p>
            <h2 className="ab-h2">Shopping made simple</h2>
            <p className="ab-p">{COMPANY.name} runs this online store from Tiruppur, Tamil Nadu. We bring together products from many categories — fashion, home and kitchen, beauty, electronics and more — so you can find what you need in one place.</p>
            <p className="ab-p">Our aim is a smooth shopping experience: easy search and filters, clear prices, {shippingPromise(brand).toLowerCase()} and secure online payments.</p>
            <p className="ab-p ab-p-hl">Our team is available {COMPANY.hours.toLowerCase()} to help with your questions.</p>
            <ul className="ab-facts">
              {facts.map(([t, ico]) => (
                <li key={t}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ico}</svg>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* VALUES */}
        <section>
          <div className="bl-sec-head"><h2 className="bl-sec-title">Why shop with us</h2></div>
          <div className="ab-values">
            {values.map(([title, desc, ico]) => (
              <div key={title} className="ab-tile">
                <span className="ab-tile-ico" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ico}</svg>
                </span>
                <h3>{title}</h3>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section>
          <div className="bl-cta teal ab-cta">
            <div className="ab-cta-copy">
              <h2>Explore the store</h2>
              <p>Browse our full range of products, or get in touch if you need a hand.</p>
            </div>
            <div className="ab-cta-btns">
              <button className="btn btn-sun" onClick={() => navigate('/shop')}>Shop now</button>
              <Link to="/contact" className="btn btn-outline" style={{ textDecoration:'none' }}>Contact us</Link>
            </div>
          </div>
        </section>
      </div>

      <style>{`
        .bl-wrap.ab-page { padding-top: 16px; padding-bottom: 32px; }
        .ab-page > * + * { margin-top: 22px; }

        .ab-story { background:#fff; border:1px solid var(--line); border-radius:8px; max-width:820px; margin-left:auto; margin-right:auto; padding:18px 16px 20px; display:grid; grid-template-columns:minmax(0,1fr); gap:18px; align-items:start; }
        .ab-story.has-media { max-width:1040px; }
        @media (min-width:768px){ .ab-story { padding:28px 32px 28px } .ab-story.has-media { grid-template-columns:minmax(0,300px) minmax(0,1fr); gap:28px } }
        .ab-media { min-width:0; }
        .ab-frame { border-radius:6px; overflow:hidden; background:#fff; border:1px solid var(--line); }
        .ab-body { min-width:0; }
        .ab-kicker { font-size:12.5px; font-weight:500; color:var(--primary); margin-bottom:4px; }
        .ab-h2 { font-family: var(--font-head); font-weight:500; font-size:clamp(18px,2vw,20px); color:var(--ink); line-height:1.3; margin:0 0 12px; }
        .ab-p { font-size:15px; color:var(--text); line-height:1.7; margin-bottom:12px; }
        .ab-p-hl { color: var(--primary); font-weight:500; margin-bottom:16px; }
        .ab-facts { list-style:none; display:grid; grid-template-columns:1fr; gap:8px; }
        @media (min-width:640px){ .ab-facts { grid-template-columns:repeat(3,minmax(0,1fr)) } }
        .ab-facts li { display:flex; align-items:center; gap:8px; padding:9px 12px; border:1px solid var(--line); border-radius:6px; background:#fff; color:var(--text); font-size:13.5px; font-weight:500; line-height:1.3; }
        .ab-facts svg { flex-shrink:0; color:var(--primary); }

        .ab-values { display:grid; grid-template-columns:1fr; gap:10px; }
        @media (min-width:768px){ .ab-values { grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px } }
        .ab-tile { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px 16px 18px; }
        .ab-tile-ico { display:flex; color: var(--primary); margin-bottom:10px; }
        .ab-tile h3 { font-family: var(--font-head); font-weight:600; font-size:14px; color:var(--ink); margin-bottom:4px; }
        .ab-tile p { font-size:13px; color: var(--text-muted); line-height:1.6; }

        .bl-cta.ab-cta { flex-direction:row; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:14px 20px; }
        .ab-cta-copy { flex:1 1 280px; position:relative; z-index:1; }
        .bl-cta.ab-cta h2 { font-family: var(--font-head); font-weight:600; font-size:clamp(18px,2vw,20px); line-height:1.25; margin-bottom:4px; }
        .bl-cta.ab-cta p { font-size:14px; max-width:520px; margin:0; opacity:.92; }
        .ab-cta-btns { display:flex; gap:10px; flex-wrap:wrap; position:relative; z-index:1; }
      `}</style>
    </div>
  );
}

// ── CONTACT ─────────────────────────────────────────────────
export function Contact() {
  const { currentUser } = useAuth();
  const { brand } = useBrand();
  const phone = brand.support_phone || COMPANY.phoneDisplay;
  const tel = (brand.support_phone || COMPANY.phoneTel).replace(/[^\d+]/g, '');
  const email = brand.support_email || COMPANY.email;
  usePageMeta({
    title: 'Contact Us',
    description: `Get in touch with ${COMPANY.name} for help with an order or a product. Call ${COMPANY.phoneDisplay} or WhatsApp us, ${COMPANY.hours.toLowerCase()}.`,
    path: '/contact',
  });
  const [form, setForm] = useState({ name:'', email: currentUser?.email || '', phone:'', subject:'', message:'' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // currentUser resolves asynchronously (session restore) -- a signed-in visitor who
  // lands directly on this page can mount before it's ready, leaving email blank forever.
  useEffect(() => {
    if (currentUser?.email) setForm(f => f.email ? f : { ...f, email: currentUser.email });
  }, [currentUser]);

  // Routed through the same service-role endpoint as the WhatsApp buttons (api/send-enquiry-whatsapp.js,
  // formSubmit:true branch) instead of a raw client-side insert -- the old direct insert depended on the
  // `enquiries` table's RLS allowing a guest write, the exact class of bug that made WhatsApp enquiries
  // silently vanish for guests. This form already showed a toast on failure, but "shows an error" isn't
  // the same as "not dependent on RLS at all" -- this closes that gap for parity with the WhatsApp path.
  async function send(e) {
    e.preventDefault();
    if (!form.name || !form.email || !form.phone || !form.message) { toast.error('Please fill in all required fields.'); return; }
    setSending(true);
    try {
      let accessToken;
      if (currentUser) {
        const { data: sessionData } = await supabase.auth.getSession();
        accessToken = sessionData?.session?.access_token;
      }
      const res = await fetch('/api/send-enquiry-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formSubmit: true,
          name: form.name, email: form.email, phone: form.phone, subject: form.subject, message: form.message,
          ...(accessToken ? { accessToken } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to send.');
      setSent(true);
      toast.success('Message sent. We will be in touch within 24 hours.');
      setForm({ name:'', email:'', phone:'', subject:'', message:'' });
    } catch { toast.error('Failed to send. Please try again.'); }
    finally { setSending(false); }
  }

  const contacts = [
    { label:'Call us', val:phone, href:`tel:${tel}`, Icon:PhoneIcon },
    { label:'WhatsApp', val:'Message us directly', href:whatsappLink(DEFAULT_WA_MESSAGE), Icon:WhatsAppIcon, wa:true },
    { label:'Email', val:email, href:`mailto:${email}`, Icon:EmailIcon },
    { label:'Website', val:COMPANY.websiteDisplay, href:COMPANY.website, Icon:GlobeIcon },
    { label:'Business hours', val:COMPANY.hours, href:null, Icon:ClockIcon },
  ];

  const fields = [
    { label:'Your name', key:'name', type:'text', ph:'Full name', ac:'name' },
    { label:'Email address', key:'email', type:'email', ph:'you@example.com', ac:'email' },
    { label:'Mobile number', key:'phone', type:'tel', ph:'+91 XXXXX XXXXX', ac:'tel' },
    { label:'Subject', key:'subject', type:'text', ph:'Order, delivery, return, product question…', ac:'off' },
  ];

  const chev = (
    <svg className="ct-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
  );

  return (
    <div style={{ background:'var(--bg)', minHeight:'100vh' }}>
      <PageHero crumb="Contact us" title="Get in touch" subtitle="Questions about a product or an order? We are here to help." />

      <div className="bl-wrap ct-page">
        <div className="ct-grid">

          {/* LEFT -- contact rows */}
          <div className="ct-side">
            <div className="ct-rows">
              {contacts.map(({ label, val, href, Icon, wa }) => {
                const inner = (
                  <>
                    <span className="ct-ico"><Icon width="22" height="22" aria-hidden="true" /></span>
                    <span className="ct-txt">
                      <span className="ct-lbl">{label}</span>
                      <span className="ct-val">{val}</span>
                    </span>
                    {href && chev}
                  </>
                );
                return href ? (
                  <a key={label} href={href} className="ct-row ct-link"
                    target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer"
                    onClick={wa ? () => recordWhatsAppEnquiry(currentUser, 'Contact page (details list)') : undefined}
                  >{inner}</a>
                ) : (
                  <div key={label} className="ct-row">{inner}</div>
                );
              })}

              {/* ADDRESS (no map embed) */}
              <div className="ct-row is-top">
                <span className="ct-ico"><PinIcon width="22" height="22" aria-hidden="true" /></span>
                <span className="ct-txt">
                  <span className="ct-lbl">Registered office</span>
                  <span className="ct-val ct-addr">
                    {COMPANY.name}<br />
                    {COMPANY.addressLines.map((l, i) => <React.Fragment key={i}>{l}{i < COMPANY.addressLines.length - 1 && <br />}</React.Fragment>)}
                  </span>
                </span>
              </div>
            </div>

            {/* WHATSAPP QUICK BTN */}
            <a href={whatsappLink(DEFAULT_WA_MESSAGE)} target="_blank" rel="noreferrer" onClick={() => recordWhatsAppEnquiry(currentUser, 'Contact page (quick button)')} className="btn btn-wa btn-full" style={{ textDecoration:'none' }}>
              <WhatsAppIcon width="18" height="18" aria-hidden="true" /> WhatsApp us now
            </a>
          </div>

          {/* RIGHT -- ENQUIRY FORM */}
          <div className="ct-form">
            <h2 className="ct-h">Send us a message</h2>
            <p className="ct-sub">Fill in the form and we will get back to you.</p>
            <ul className="ct-points">
              <li>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                We will be in touch within 24 hours
              </li>
              <li>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                Our team is available {COMPANY.hours.toLowerCase()}
              </li>
            </ul>

            {sent && (
              <div role="status" className="form-success">
                Your message has been received. We will be in touch within 24 hours.
              </div>
            )}
            <form onSubmit={send}>
              <div className="ct-fields">
                {fields.map(({ label, key, type, ph, ac }) => (
                  <div className="form-group" key={key}>
                    <label className="form-label" htmlFor={`contact-${key}`}>{label}</label>
                    <input id={`contact-${key}`} className="form-input" type={type} value={form[key]} placeholder={ph} autoComplete={ac}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="contact-message">Message</label>
                <textarea id="contact-message" className="form-textarea" value={form.message} placeholder="How can we help?" rows={5}
                  onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  style={{ resize:'vertical', minHeight:120, lineHeight:1.6 }}
                />
              </div>
              <button type="submit" className="btn btn-gold ct-submit" disabled={sending}>
                {sending ? <span className="spinner"></span> : 'Send message'}
              </button>
            </form>
          </div>
        </div>
      </div>

      <style>{`
        .bl-wrap.ct-page { padding-top: 16px; padding-bottom: 32px; }
        .ct-grid { display:grid; grid-template-columns:minmax(0,1fr); gap:14px; align-items:start; }
        @media (min-width:900px){ .ct-grid { grid-template-columns:minmax(0,380px) minmax(0,1fr); gap:20px } }

        .ct-side { display:grid; gap:10px; min-width:0; }
        .ct-rows { display:grid; gap:10px; }
        .ct-row { display:flex; gap:14px; align-items:center; min-width:0; padding:12px 14px; background:#fff; border:1px solid var(--line); border-radius:8px; color:var(--text); text-decoration:none; transition: border-color .15s; }
        .ct-row.is-top { align-items:flex-start; }
        @media (hover:hover) and (pointer:fine){ a.ct-row:hover { border-color: var(--primary); } }
        .ct-ico { display:flex; flex-shrink:0; color:var(--primary); }
        .ct-row.is-top .ct-ico { margin-top:2px; }
        .ct-txt { display:block; min-width:0; flex:1; }
        .ct-lbl { display:block; font-size:12px; font-weight:400; color: var(--text-muted); margin-bottom:1px; }
        .ct-val { display:block; font-size:14.5px; font-weight:500; color: var(--ink); overflow-wrap:anywhere; line-height:1.4; }
        .ct-addr { line-height:1.55; }
        .ct-chev { flex-shrink:0; color:#8A9694; }

        .ct-form { background:#fff; border:1px solid var(--line); border-radius:8px; padding:18px 16px 20px; min-width:0; }
        @media (min-width:768px){ .ct-form { padding:24px 24px 24px } }
        .ct-h { font-family: var(--font-head); font-weight:500; font-size:clamp(18px,2vw,20px); line-height:1.3; color:var(--ink); }
        .ct-sub { font-size:14px; color:var(--text-muted); margin-top:2px; }
        .ct-points { list-style:none; display:flex; flex-wrap:wrap; gap:6px 18px; margin:10px 0 18px; padding-bottom:16px; border-bottom:1px solid var(--line); }
        .ct-points li { display:flex; align-items:center; gap:6px; font-size:13px; color:var(--text); }
        .ct-points svg { flex-shrink:0; color:var(--primary); }
        .ct-fields { display:grid; grid-template-columns:1fr; gap:0 16px; }
        @media (min-width:640px){ .ct-fields { grid-template-columns:1fr 1fr } }
        .ct-submit { min-width:180px; }
        @media (max-width:639px){ .ct-submit { width:100%; } }
        .ct-submit .spinner { width:18px; height:18px; border-width:2px; border-color:rgba(255,255,255,.4); border-top-color:#fff; }
      `}</style>
    </div>
  );
}
