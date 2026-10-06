import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { DEFAULT_GIFTCARD_MIN } from '../utils/pricing';
import { withTimeout } from '../utils/withTimeout';
import { COMPANY } from '../config/company';

const BrandContext = createContext();
export function useBrand() { return useContext(BrandContext); }

export function BrandProvider({ children }) {
  const [brand, setBrand] = useState({
    logo_url: '',
    brand_name: COMPANY.name,
    tagline: COMPANY.tagline,
    // Per-page hero images -- Home's own hero is managed entirely via the Hero
    // Slides tab (hero_slides table) instead of a field here.
    hero_shop: '',           // Shop
    hero_shop_mobile_image: '',    // Shop -- dedicated mobile photo, optional
    hero_about: '',          // About
    hero_about_mobile_image: '',   // About -- dedicated mobile photo, optional
    hero_services: '',       // Services
    hero_services_mobile_image: '', // Services -- dedicated mobile photo, optional
    hero_stories: '',        // Stories
    hero_stories_mobile_image: '', // Stories -- dedicated mobile photo, optional
    hero_care: '',           // Care
    hero_care_mobile_image: '',    // Care -- dedicated mobile photo, optional
    hero_giftcard: '',       // Gift Card
    hero_giftcard_mobile_image: '', // Gift Card -- dedicated mobile photo, optional
    about_image: '',         // About page side image
    order_confirmation_hero_image: '', // Hero image shown in the ORDER_CONFIRMED email
    // Social links -- shown in the email footer (and available for the site
    // footer/Contact page too) only when actually set; never fabricated.
    instagram_url: '',
    facebook_url: '',
    youtube_url: '',
    pinterest_url: '',
    // Focal point (crop position) for each image above
    hero_shop_position: '50% 50%',
    hero_about_position: '50% 50%',
    hero_services_position: '50% 50%',
    hero_stories_position: '50% 50%',
    hero_care_position: '50% 50%',
    hero_giftcard_position: '50% 50%',
    about_image_position: '50% 50%',
    about_image_mobile_position: '', // empty = fall back to about_image_position on mobile too
    // Splash / loading screen logo (shown while the site loads)
    splash_logo: '',
    // About page "Our Journey" video
    about_video: '',
    about_video_caption: '',
    // Registered office address shown in the footer
    registered_office: COMPANY.addressOneLine,
    // Home showcase control
    featured_count: 3,
    // Home page editable section text
    home_featured_label: 'Featured',
    home_featured_title: 'Top Picks For You',
    home_ink_eyebrow: 'Why Brightlight',
    home_ink_title: 'Everything you need, delivered to your door.',
    home_ink_body: 'Shop everyday products across fashion, home, beauty, electronics and more — with free delivery on every order and secure online payments.',
    home_ig_followers: '',
    // Tagline shown just below the Featured Products showcase
    home_tagline_heading: "Shop smart. Shop Brightlight.",
    // Gift card page settings
    giftcard_enabled: true,
    giftcard_min: DEFAULT_GIFTCARD_MIN,
    giftcard_max: null, // null = no upper limit
    giftcard_description: "A Brightlight Solutions gift card lets someone choose exactly what they love. Pick an amount, and we'll take care of the rest.",
    // Delivery estimate settings — cities in this list get each product's base
    // delivery_min_days/delivery_max_days; anywhere else gets that plus delivery_extra_days.
    delivery_metro_cities: 'Delhi, New Delhi, Mumbai, Bengaluru, Bangalore, Chennai, Hyderabad, Kolkata, Pune, Ahmedabad',
    delivery_extra_days: 3,
    // Shipping, payments, tax and returns (Admin -> Settings). Same defaults as the settings columns in
    // supabase/schema.sql so the site behaves identically before the row loads.
    free_shipping_threshold: 499,   // cart value (before coupons) at or above which delivery is free; 0 = no threshold
    shipping_fee_metro: 40,
    shipping_fee_other: 60,
    cod_enabled: false,
    cod_fee: 0,
    cod_max_order: 5000,
    return_window_days: 7,
    low_stock_threshold: 5,
    default_gst_rate: 18,
    seller_legal_name: '',
    seller_gstin: '',
    seller_state: 'Tamil Nadu',
    gift_card_validity_months: 6,
    support_email: '',
    support_phone: '',
    // Homepage hero slider -- applies to the whole slider, not per-slide (the
    // slides share one timer and one set of nav controls).
    hero_slider_interval_ms: 4000,
    hero_slider_show_dots: true,
    hero_slider_show_arrows: true,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchBrand() {
      try {
        // A stalled request here (dropped connection, no response, no error --
        // just never settling) used to hang this forever: the try/catch/finally
        // below only runs once the awaited promise actually settles one way or
        // the other, and a plain fetch has no built-in timeout. Since this gates
        // the full-screen splash overlay, a real-world hang meant the entire site
        // stayed invisible behind it indefinitely, with a manual refresh as the
        // only way out. Racing it against a timeout guarantees this always
        // settles, one way or another, within a bounded time.
        const { data } = await withTimeout(
          supabase.from('settings').select('*').eq('id', 'brand').single(),
          8000
        );
        if (data) setBrand(b => ({ ...b, ...data }));
      } catch (e) { /* use defaults -- covers both a real error and a timeout */ }
      finally { setLoading(false); }
    }
    fetchBrand();
  }, []);

  async function updateBrand(updates) {
    const { data, error } = await supabase.from('settings').upsert({ id: 'brand', ...updates }).select('id');
    if (error) throw error;
    // An update that row-level security quietly refuses reports no error and no rows -- never say "saved" then.
    if (!data?.length) throw new Error('Nothing was saved. Please check that you are signed in as the store admin.');
    setBrand(b => ({ ...b, ...updates }));
  }

  return (
    <BrandContext.Provider value={{ brand, updateBrand, loading }}>
      {children}
    </BrandContext.Provider>
  );
}
