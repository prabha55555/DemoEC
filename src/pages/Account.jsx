import React, { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../supabase';
import { useAuth } from '../context/AuthContext';
import { useWishlist } from '../context/WishlistContext';
import { safeQuery } from '../utils/safeFetch';
import { formatMoney } from '../utils/catalog';
import { fmtDate, isPlaceholderEmail, maskPhone, orderItemsOf } from '../utils/orderFormat';
import { whatsappLink } from '../config/company';
import { usePageMeta } from '../utils/usePageMeta';
import { NavIcon } from '../components/AccountParts';
import { StatusBadge } from '../components/OrderStatusTracker';
import AccountOrdersTab, { ORDER_LIST_COLUMNS } from '../components/AccountOrdersTab';
import AccountWishlistTab from '../components/AccountWishlistTab';
import AccountAddressesTab from '../components/AccountAddressesTab';
import { CouponsTab, DetailsTab, GiftCardsTab, NotificationsTab, SupportTab } from '../components/AccountMoreTabs';

// `enquiries` keeps its old key so existing links (?tab=enquiries) keep working; it is shown as "Support".
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'orders', label: 'Orders' },
  { key: 'wishlist', label: 'Wishlist' },
  { key: 'addresses', label: 'Addresses' },
  { key: 'coupons', label: 'Coupons' },
  { key: 'giftcards', label: 'Gift Cards' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'enquiries', label: 'Support' },
  { key: 'details', label: 'Account Details' },
];
const TAB_ALIASES = { support: 'enquiries', queries: 'enquiries' };
const tabFromParam = (p) => { const k = TAB_ALIASES[p] || p; return NAV_ITEMS.some(n => n.key === k) ? k : 'dashboard'; };

const ACCOUNT_CSS = `
  .acc-page { padding-top: var(--hdr-h); min-height: 100vh; background: var(--bg); }
  .acc-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

  /* layout: grey page, white bordered cards */
  .acc-wrap { padding-top: 0; padding-bottom: 40px; }
  .acc-layout { display: grid; grid-template-columns: minmax(0,1fr); gap: 0; align-items: start; }
  .acc-content { min-width: 0; padding-top: 14px; }
  .acc-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; }

  /* profile row */
  .acc-profile { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .acc-avatar { width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0; background: var(--primary-tint); border: 1px solid var(--primary-border); color: var(--primary); font-weight: 600; font-size: 18px; display: flex; align-items: center; justify-content: center; }
  .acc-pinfo { min-width: 0; flex: 1; }
  .acc-pname { font-weight: 500; font-size: 15px; line-height: 1.3; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .acc-pmeta { font-size: 12.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.4; }

  /* mobile: slim profile row + underline tab strip */
  .account-sidebar { display: none; }
  .acc-mtop { margin: 0 -14px; background: #fff; border-bottom: 1px solid var(--border); min-width: 0; }
  .acc-mtop .acc-profile { padding: 10px 14px; }
  .acc-mtop .acc-avatar { width: 40px; height: 40px; font-size: 16px; }
  .acc-mtop .acc-pmeta + .acc-pmeta { display: none; }
  .acc-mlogout { flex-shrink: 0; min-height: 34px; padding: 0 12px; border: 1px solid var(--border); border-radius: 6px; background: #fff; color: var(--error); font-size: 13px; font-weight: 500; cursor: pointer; }
  .account-nav-scroll { display: flex; overflow-x: auto; scrollbar-width: none; border-top: 1px solid var(--border); padding: 0 6px; }
  .account-nav-scroll::-webkit-scrollbar { display: none; }
  .acc-pill { flex-shrink: 0; min-height: 44px; padding: 0 12px; margin-bottom: -1px; border: none; border-bottom: 2px solid transparent; background: transparent; color: var(--text-muted); font-size: 13.5px; font-weight: 500; white-space: nowrap; cursor: pointer; transition: color .15s, border-color .15s; }
  .acc-pill.is-active { color: var(--primary); border-bottom-color: var(--primary); font-weight: 600; }

  /* desktop: bordered nav card */
  .acc-side { position: sticky; top: calc(var(--hdr-h) + 14px); margin-top: 14px; background: #fff; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .acc-side .acc-profile { padding: 16px; border-bottom: 1px solid var(--border); }
  .acc-nav { display: flex; flex-direction: column; padding: 6px 0; }
  .acc-navbtn { position: relative; display: flex; align-items: center; gap: 14px; width: 100%; min-height: 46px; padding: 0 16px; border: none; background: transparent; color: var(--text); font-size: 14px; font-weight: 500; text-align: left; cursor: pointer; transition: background .12s, color .12s; }
  .acc-navbtn:focus-visible { outline-offset: -2px; }
  .acc-navico { display: flex; flex-shrink: 0; color: var(--text-muted); }
  .acc-navbtn:hover { background: #F5F8F7; }
  .acc-navbtn.is-active { background: var(--primary-tint); color: var(--primary); }
  .acc-navbtn.is-active .acc-navico { color: var(--primary); }
  .acc-navbtn.is-active::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--primary); }
  .acc-navcount { margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: #EEF2F1; color: var(--text-muted); font-size: 11.5px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
  .acc-navbtn.is-active .acc-navcount { background: #fff; color: var(--primary); }
  .acc-navsep { height: 1px; background: var(--border); margin: 6px 0; }
  .acc-navbtn.is-logout, .acc-navbtn.is-logout .acc-navico { color: var(--error); }
  .acc-navbtn.is-logout:hover { background: #FDEBE9; }

  /* headings & small text */
  .acc-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  .acc-h { font-family: var(--font-head); font-weight: 500; font-size: clamp(18px, 2vw, 22px); line-height: 1.25; color: var(--text); margin: 0; }
  .acc-sub { font-size: 13px; color: var(--text-muted); margin: 3px 0 0; line-height: 1.5; max-width: 560px; }
  .acc-muted { font-size: 12.5px; color: var(--text-muted); line-height: 1.45; }
  .acc-link { display: inline-block; font-size: 13px; font-weight: 500; color: var(--primary); padding: 6px 0; }
  .acc-link:hover { text-decoration: underline; }
  .acc-linkbtn { background: none; border: none; padding: 6px 0; cursor: pointer; }
  .acc-price { font-weight: 600; font-size: 16px; color: var(--text); }

  /* dashboard */
  .acc-hello { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
  .acc-hello h2 { font-family: var(--font-head); font-weight: 500; font-size: clamp(18px, 2vw, 22px); line-height: 1.25; color: var(--text); margin: 0; overflow-wrap: anywhere; }
  .acc-hello p { font-size: 13.5px; color: var(--text-muted); line-height: 1.5; margin: 3px 0 0; max-width: 520px; }
  .acc-tiles { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
  .acc-tile { text-align: left; display: flex; flex-direction: column; gap: 10px; padding: 14px; background: #fff; border: 1px solid var(--border); border-radius: 8px; color: var(--text); cursor: pointer; transition: border-color .15s; }
  .acc-tile:hover { border-color: var(--primary); }
  .acc-tile-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .acc-tile-ico { width: 40px; height: 40px; border-radius: 50%; background: var(--primary-tint); color: var(--primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .acc-tile-count { font-weight: 600; font-size: 18px; line-height: 1; color: var(--text); }
  .acc-tile-label { font-size: 14px; font-weight: 500; color: var(--text); }
  .acc-tile-hint { font-size: 12px; color: var(--text-muted); margin-top: 2px; line-height: 1.35; }
  .acc-help { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 12px; padding: 14px 16px; background: #fff; border: 1px solid var(--border); border-radius: 8px; }
  .acc-help strong { display: block; font-weight: 500; font-size: 14px; color: var(--text); }
  .acc-recent { margin-top: 18px; }
  .acc-recent h3 { font-family: var(--font-head); font-size: 15px; font-weight: 500; margin: 0 0 8px; color: var(--text); }
  .acc-recent-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #F0F3F2; color: var(--text); }
  .acc-recent-row:last-child { border-bottom: none; }
  .acc-recent-row:hover { background: #FAFBFB; }
  .acc-recent-main { min-width: 0; flex: 1; }
  .acc-recent-name { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* orders list */
  .acc-filters { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
  .acc-chips { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
  .acc-chips::-webkit-scrollbar { display: none; }
  .acc-chip { flex-shrink: 0; min-height: 36px; padding: 0 14px; border: 1px solid #CDD6D4; border-radius: 999px; background: #fff; color: var(--text); font-size: 13px; font-weight: 500; cursor: pointer; transition: border-color .12s, background .12s, color .12s; }
  .acc-chip:hover { border-color: var(--primary); }
  .acc-chip.is-on { background: var(--primary); border-color: var(--primary); color: #fff; }
  .acc-search .form-input { height: 40px; background: #fff; }
  .acc-orders { display: flex; flex-direction: column; gap: 12px; }
  .ord-card { overflow: hidden; }
  .ord-head { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
  .ord-num { font-weight: 600; font-size: 14.5px; color: var(--text); overflow-wrap: anywhere; }
  .ord-num:hover { color: var(--primary); }
  .ord-body { display: flex; gap: 14px; padding: 14px 16px 6px; align-items: flex-start; }
  .ord-thumbs { display: flex; gap: 6px; flex-shrink: 0; }
  .ord-thumb { width: 56px; height: 56px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: #EFF3F2; color: #8A9694; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; }
  .ord-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ord-info { min-width: 0; flex: 1; }
  .ord-first { display: block; font-size: 14px; font-weight: 500; color: var(--text); line-height: 1.4; overflow-wrap: anywhere; }
  .ord-first:hover { color: var(--primary); }
  .ord-pay { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; margin-top: 6px; font-size: 15px; }
  .ord-paytag { padding: 2px 9px; border-radius: 999px; background: #E3F6EE; color: var(--success); font-size: 11.5px; font-weight: 600; }
  .ord-paytag.is-cod { background: var(--sun-tint); color: var(--sun-text); }
  .ord-track { padding: 10px 16px 14px; }
  .ord-foot { display: flex; gap: 8px; flex-wrap: wrap; padding: 12px 16px; border-top: 1px solid var(--border); background: #FAFBFB; }
  .acc-pager { display: flex; align-items: center; justify-content: center; gap: 14px; padding: 6px 0; font-size: 13px; color: var(--text-muted); }

  /* simple list rows (queries, notifications) */
  .acc-list { padding: 0 16px; }
  .acc-lrow { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid #F0F3F2; }
  .acc-lrow:last-child { border-bottom: none; }
  .acc-lico { width: 36px; height: 36px; border-radius: 50%; background: var(--primary-tint); color: var(--primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .acc-lname { display: block; font-size: 14px; font-weight: 500; color: var(--text); overflow-wrap: anywhere; }
  a.acc-lname:hover { color: var(--primary); }
  .acc-lbadges { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }

  /* empty state */
  .acc-empty { background: #fff; border: 1px solid var(--border); border-radius: 8px; text-align: center; padding: 36px 20px 40px; display: flex; flex-direction: column; align-items: center; }
  .acc-ill { width: 88px; height: 88px; color: var(--primary); margin-bottom: 10px; }
  .acc-ill-ground { fill: #E4E8E7; }
  .acc-ill-line { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .acc-empty-title { font-weight: 500; font-size: 16px; color: var(--text); }
  .acc-empty-text { font-size: 13.5px; color: var(--text-muted); margin: 4px 0 16px; max-width: 340px; line-height: 1.5; }
  .acc-empty-text:last-child { margin-bottom: 0; }
  .acc-empty-title + .btn { margin-top: 14px; }

  /* wishlist: flat bordered product cards */
  .bl-grid.acc-wgrid { grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
  .acc-wcard { position: relative; display: flex; flex-direction: column; background: #fff; border: 1px solid #E6EBEA; border-radius: 6px; overflow: hidden; transition: box-shadow .15s, border-color .15s; }
  .acc-wimg { display: block; width: 100%; aspect-ratio: 1 / 1.12; border: none; padding: 0; background: #EFF3F2; overflow: hidden; }
  .acc-wimg img { width: 100%; height: 100%; object-fit: cover; }
  .acc-wheart { position: absolute; top: 8px; right: 8px; z-index: 2; width: 36px; height: 36px; border-radius: 50%; border: none; background: rgba(255,255,255,.95); color: var(--coral); display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 4px rgba(0,0,0,.15); cursor: pointer; }
  .acc-wbody { padding: 9px 10px 10px; display: flex; flex-direction: column; gap: 3px; flex: 1; }
  .acc-wbrand { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .03em; }
  .acc-wname { font-size: 13px; font-weight: 400; color: #3D4A48; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.7em; }
  .acc-wprice { font-weight: 600; font-size: 15px; color: var(--text); display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 6px; }
  .acc-wmrp { font-weight: 400; font-size: 12px; color: var(--text-muted); }
  .acc-woff { font-weight: 600; font-size: 12px; color: var(--success); }
  .acc-wstock { font-size: 12px; color: var(--success); }
  .acc-wstock.is-out { color: var(--error); font-weight: 500; }
  .acc-wactions { margin-top: auto; padding-top: 8px; }
  .acc-wactions .btn { width: 100%; }

  /* ticket cards (gift cards + coupons): dashed left stub */
  .acc-tickets { display: flex; flex-direction: column; gap: 10px; }
  .acc-ticket { display: flex; background: #fff; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .acc-ticket-stub { flex: 0 0 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 14px 8px; background: var(--primary-tint); color: var(--primary-dark); border-right: 1.5px dashed var(--primary-border); }
  .acc-ticket-big { font-weight: 600; font-size: 20px; line-height: 1.15; overflow-wrap: anywhere; }
  .acc-ticket-small { font-size: 12px; font-weight: 500; margin-top: 2px; opacity: .85; }
  .acc-ticket-main { flex: 1; min-width: 0; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .acc-ticket-kind { font-size: 12px; font-weight: 500; color: var(--text-muted); margin-bottom: 4px; }
  .acc-code { font-weight: 600; font-size: 14px; letter-spacing: .02em; color: var(--text); overflow-wrap: anywhere; }
  .acc-code.is-coupon { display: inline-block; padding: 3px 10px; border: 1px dashed var(--primary); border-radius: 4px; color: var(--primary); background: #fff; }
  .acc-ticket-desc { font-size: 13.5px; color: var(--text); margin-top: 6px; line-height: 1.45; }
  .acc-terms { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 2px 14px; font-size: 12px; color: var(--text-muted); }

  /* addresses */
  .acc-addrs { display: grid; grid-template-columns: minmax(0,1fr); gap: 12px; margin-bottom: 16px; }
  .acc-addr { position: relative; display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; background: #fff; border: 1px solid var(--border); border-radius: 8px; transition: border-color .15s, background .15s; }
  .acc-addr.is-editing { border-color: var(--primary); background: var(--primary-tint); }
  .acc-addr-top { display: flex; align-items: center; gap: 8px; }
  .acc-addr-pin { width: 32px; height: 32px; border-radius: 50%; background: var(--primary-tint); color: var(--primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .acc-addr.is-editing .acc-addr-pin { background: #fff; }
  .acc-addr-body { display: block; width: 100%; text-align: left; font-size: 13.5px; line-height: 1.6; color: var(--text); overflow-wrap: anywhere; }
  .acc-addr-body strong { display: block; font-size: 14px; font-weight: 500; color: var(--text); }
  .acc-addr-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; }

  /* forms */
  .acc-form-card { padding: 20px; }
  .acc-form-grid { display: grid; grid-template-columns: minmax(0,1fr); gap: 14px; }
  .acc-form-card .form-input, .acc-form-card .form-select { min-height: 44px; font-size: 16px; }
  .acc-form-card .form-input:disabled { background: var(--bg-hover); color: var(--text-muted); cursor: not-allowed; }
  .acc-formhead { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; }
  .acc-check { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; font-size: 13.5px; line-height: 1.55; color: var(--text); }
  .acc-check input { margin-top: 2px; width: 16px; height: 16px; flex-shrink: 0; accent-color: var(--primary); cursor: pointer; }
  .acc-modal-back { position: fixed; inset: 0; background: rgba(15,25,24,.5); z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .acc-modal { position: relative; width: 100%; max-width: 420px; background: #fff; border-radius: 8px; padding: 24px; box-shadow: var(--shadow-lg); }
  .acc-modal-x { position: absolute; top: 8px; right: 8px; width: 40px; height: 40px; background: none; border: none; font-size: 24px; line-height: 1; color: var(--text-muted); border-radius: 50%; cursor: pointer; }
  .acc-modal-x:hover { background: var(--bg-hover); }

  @media (min-width: 560px) {
    .acc-form-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
    .acc-addrs { grid-template-columns: repeat(2, minmax(0,1fr)); }
    .acc-filters { flex-direction: row; align-items: center; justify-content: space-between; }
    .acc-search { width: 260px; flex-shrink: 0; }
  }
  @media (min-width: 640px) {
    .bl-grid.acc-wgrid { grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; }
    .acc-form-card .form-input, .acc-form-card .form-select { min-height: 42px; font-size: 14px; }
  }
  @media (min-width: 768px) {
    .acc-mtop { margin: 0 -20px; }
    .acc-mtop .acc-profile { padding: 10px 20px; }
    .account-nav-scroll { padding: 0 14px; }
  }
  @media (min-width: 900px) {
    .acc-layout { grid-template-columns: 264px minmax(0,1fr); gap: 20px; }
    .account-sidebar { display: block; }
    .acc-mtop { display: none; }
  }
  @media (min-width: 1100px) {
    .acc-tiles { grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; }
  }
  @media (hover: hover) and (pointer: fine) {
    .acc-wcard:hover { box-shadow: var(--shadow-md); border-color: #D2DBD9; }
    .acc-addr:not(.is-editing):hover { border-color: var(--primary-border); }
  }
  @media (min-width: 1280px) {
    .bl-grid.acc-wgrid { grid-template-columns: repeat(4, minmax(0,1fr)); gap: 14px; }
  }
  @media (max-width: 520px) {
    .acc-ticket-stub { flex-basis: 96px; }
    .acc-ticket-big { font-size: 17px; }
    .ord-head, .ord-body, .ord-track, .ord-foot { padding-left: 14px; padding-right: 14px; }
    .ord-foot .btn { flex: 1 1 calc(50% - 8px); text-align: center; }
    .ord-thumb { width: 48px; height: 48px; }
  }
`;

const DASH_TILES = [
  { key: 'orders', label: 'Orders', hint: 'Track, cancel or return your orders' },
  { key: 'wishlist', label: 'Wishlist', hint: 'Items you saved for later' },
  { key: 'addresses', label: 'Addresses', hint: 'Where we deliver your orders' },
  { key: 'coupons', label: 'Coupons', hint: 'Offers you can use at checkout' },
  { key: 'giftcards', label: 'Gift Cards', hint: 'Link a code and see the balance' },
  { key: 'notifications', label: 'Notifications', hint: 'Back-in-stock alerts' },
  { key: 'enquiries', label: 'Support', hint: 'Questions you have sent us' },
  { key: 'details', label: 'Account Details', hint: 'Name, phone and preferences' },
];

function DashboardTab({ name, userId, wishlistCount, giftCount, onNav, onShop }) {
  const [recent, setRecent] = useState({ rows: [], count: null, loading: true });
  useEffect(() => {
    let alive = true;
    safeQuery(supabase.from('orders').select(ORDER_LIST_COLUMNS, { count: 'exact' }).eq('user_id', userId).is('deleted_at', null).order('created_at', { ascending: false }).range(0, 2))
      .then(res => { if (alive) setRecent({ rows: res.data || [], count: res.error ? null : (typeof res.count === 'number' ? res.count : (res.data || []).length), loading: false }); });
    return () => { alive = false; };
  }, [userId]);
  const counts = { orders: recent.count ?? undefined, wishlist: wishlistCount, giftcards: giftCount };
  return (
    <div>
      <div className="acc-hello">
        <div>
          <h2>Hello, {name}</h2>
          <p>Track your orders, manage saved items and addresses, and keep your gift cards and coupons in one place.</p>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={onShop}>Continue shopping</button>
      </div>
      <div className="acc-tiles">
        {DASH_TILES.map(t => (
          <button type="button" key={t.key} onClick={() => onNav(t.key)} className="acc-tile">
            <div className="acc-tile-top">
              <div className="acc-tile-ico"><NavIcon name={t.key} size={20} /></div>
              {counts[t.key] !== undefined && <div className="acc-tile-count">{counts[t.key]}</div>}
            </div>
            <div>
              <div className="acc-tile-label">{t.label}</div>
              <div className="acc-tile-hint">{t.hint}</div>
            </div>
          </button>
        ))}
      </div>

      {!recent.loading && recent.rows.length > 0 && (
        <div className="acc-recent">
          <h3>Recent orders</h3>
          <div className="acc-card">
            {recent.rows.map(o => {
              const items = orderItemsOf(o);
              return (
                <Link key={o.id} to={`/account/orders/${encodeURIComponent(o.order_id)}`} className="acc-recent-row">
                  <div className="acc-recent-main">
                    <div className="acc-recent-name">{items[0]?.name || 'Order'}{items.length > 1 ? ` + ${items.length - 1} more` : ''}</div>
                    <div className="acc-muted">{o.order_id} · {fmtDate(o.created_at)} · {formatMoney(o.total)}</div>
                  </div>
                  <StatusBadge status={o.status} />
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="acc-help">
        <div>
          <strong>Need help with an order?</strong>
          <span className="acc-muted">Our team is available on WhatsApp.</span>
        </div>
        <a className="btn btn-wa btn-sm" href={whatsappLink()} target="_blank" rel="noreferrer">Chat on WhatsApp</a>
      </div>
    </div>
  );
}

export default function Account() {
  const { currentUser, userProfile, logout, refreshProfile, updateProfile } = useAuth();
  const wishlist = useWishlist();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabFromParam(searchParams.get('tab'));
  const navScrollRef = useRef(null);
  usePageMeta({ title: 'My Account', description: 'Your orders, addresses, wishlist and account details.' });

  // Deep-linking straight to a tab past the first few (e.g. /account?tab=coupons) left the mobile pill strip
  // scrolled to its start, with no pill visibly active -- scroll the active pill into view within the strip
  // itself (never the page) whenever the tab changes.
  useEffect(() => {
    const strip = navScrollRef.current;
    if (!strip) return;
    const activePill = strip.querySelector(`[data-tab="${tab}"]`);
    if (!activePill) return;
    const stripRect = strip.getBoundingClientRect();
    const pillRect = activePill.getBoundingClientRect();
    if (pillRect.left < stripRect.left || pillRect.right > stripRect.right) {
      strip.scrollLeft += (pillRect.left - stripRect.left) - (stripRect.width - pillRect.width) / 2;
    }
  }, [tab]);

  function selectTab(key) {
    setSearchParams(key === 'dashboard' ? {} : { tab: key });
  }

  async function handleLogout() {
    await logout();
    toast.success('Signed out.');
    navigate('/');
  }

  if (!currentUser) return <Navigate to="/login" state={{ from: location }} replace />;

  const giftCount = (userProfile?.gift_cards || []).length;
  const displayName = userProfile?.name || (isPlaceholderEmail(currentUser.email) ? '' : currentUser.email?.split('@')[0]) || 'there';
  const initial = (displayName.trim().charAt(0) || 'U').toUpperCase();
  // A mobile-OTP account has a placeholder address: show the (masked) number instead of it.
  const contactLine = isPlaceholderEmail(currentUser.email)
    ? maskPhone(userProfile?.phone || currentUser.app_metadata?.msg91_phone)
    : currentUser.email;
  const navCounts = { wishlist: wishlist.count };

  const profileInfo = (
    <>
      <div className="acc-avatar" aria-hidden="true">{initial}</div>
      <div className="acc-pinfo">
        <div className="acc-pname">{displayName}</div>
        {contactLine && <div className="acc-pmeta">{contactLine}</div>}
      </div>
    </>
  );

  return (
    <div className="acc-page">
      <div className="bl-wrap acc-wrap">
        <h1 className="acc-sr">My account</h1>
        <div className="account-layout acc-layout">

          {/* SIDEBAR -- desktop: bordered nav card (profile row, vertical list, log out), sticky */}
          <aside className="account-sidebar acc-side" aria-label="Account navigation">
            <div className="acc-profile">{profileInfo}</div>
            <nav className="acc-nav">
              {NAV_ITEMS.map(n => (
                <button type="button" key={n.key} onClick={() => selectTab(n.key)} className={`acc-navbtn${tab === n.key ? ' is-active' : ''}`} aria-current={tab === n.key ? 'page' : undefined}>
                  <span className="acc-navico"><NavIcon name={n.key} size={20} /></span>
                  <span>{n.label}</span>
                  {navCounts[n.key] > 0 && <span className="acc-navcount">{navCounts[n.key]}</span>}
                </button>
              ))}
              <div className="acc-navsep" aria-hidden="true" />
              <button type="button" onClick={handleLogout} className="acc-navbtn is-logout">
                <span className="acc-navico"><NavIcon name="logout" size={20} /></span>
                <span>Log out</span>
              </button>
            </nav>
          </aside>

          {/* MOBILE -- slim profile row (with Log out) and a horizontally scrollable underline-tab strip */}
          <div className="account-nav-mobile acc-mtop">
            <div className="acc-profile">
              {profileInfo}
              <button type="button" onClick={handleLogout} className="acc-mlogout">Log out</button>
            </div>
            <div className="account-nav-scroll" ref={navScrollRef} role="tablist" aria-label="Account sections">
              {NAV_ITEMS.map(n => (
                <button type="button" key={n.key} role="tab" aria-selected={tab === n.key} data-tab={n.key} onClick={() => selectTab(n.key)} className={`acc-pill${tab === n.key ? ' is-active' : ''}`}>
                  {n.label}
                </button>
              ))}
            </div>
          </div>

          {/* CONTENT */}
          <div className="acc-content">
            {tab === 'dashboard' && (
              <DashboardTab name={displayName} userId={currentUser.id} wishlistCount={wishlist.count} giftCount={giftCount} onNav={selectTab} onShop={() => navigate('/shop')} />
            )}
            {tab === 'orders' && <AccountOrdersTab userId={currentUser.id} />}
            {tab === 'wishlist' && <AccountWishlistTab />}
            {tab === 'addresses' && <AccountAddressesTab userProfile={userProfile} currentUser={currentUser} refreshProfile={refreshProfile} />}
            {tab === 'coupons' && <CouponsTab />}
            {tab === 'giftcards' && <GiftCardsTab userProfile={userProfile} updateProfile={updateProfile} />}
            {tab === 'notifications' && <NotificationsTab currentUser={currentUser} />}
            {tab === 'enquiries' && <SupportTab currentUser={currentUser} />}
            {tab === 'details' && <DetailsTab userProfile={userProfile} currentUser={currentUser} updateProfile={updateProfile} />}
          </div>
        </div>
      </div>

      <style>{ACCOUNT_CSS}</style>
    </div>
  );
}
