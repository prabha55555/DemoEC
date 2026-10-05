// Combined lookup proxy -- merges the former api/lookup-coupon.js and
// api/lookup-gift-card.js into one Vercel serverless function (Hobby plan
// caps deployments at 12 functions; this consolidation is purely about
// staying under that cap, not a behavior change). Dispatches strictly on
// `type`, each branch identical to its original file, with an explicit
// `return` after every branch so a coupon lookup can never fall through
// into the gift-card table or vice versa.
import { supabaseAdmin } from '../src/utils/supabaseAdmin.js';
import { isRateLimited, clientIp } from '../src/utils/rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { type, code, codes } = req.body || {};

  // Public, unauthenticated code lookups are the obvious place to guess gift-card / coupon codes
  // -- each code counts as one lookup against a per-IP budget, and a batch is capped in size.
  // (In-memory per instance: slows a single client, not a global guarantee -- see rateLimit.js.)
  const lookups = type === 'gift-card' && Array.isArray(codes) ? Math.min(codes.length, 1000) : 1;
  if (Array.isArray(codes) && codes.length > 50) {
    res.status(400).json({ error: 'Too many codes in one request.' });
    return;
  }
  if (isRateLimited(`lookup:${clientIp(req)}`, { limit: 60, windowMs: 60 * 1000, cost: lookups })) {
    res.status(429).json({ error: 'Too many lookups. Please wait a moment and try again.' });
    return;
  }

  // ---- type: "coupon" -- identical to the former lookup-coupon.js ----
  if (type === 'coupon') {
    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Missing coupon code.' });
      return;
    }
    try {
      const { data, error } = await supabaseAdmin
        .from('coupons')
        .select('*')
        .eq('code', code.trim().toUpperCase())
        .eq('active', true)
        .maybeSingle();
      if (error) {
        console.error('lookup: coupon query failed.', error.message);
        res.status(500).json({ error: 'Could not look up coupon.' });
        return;
      }
      res.status(200).json({ coupon: data || null });
    } catch (err) {
      console.error('lookup: unexpected coupon failure.', err?.message);
      res.status(500).json({ error: 'Could not look up coupon.' });
    }
    return;
  }

  // ---- type: "gift-card" -- identical to the former lookup-gift-card.js,
  // same two modes (single code / batch codes) ----
  if (type === 'gift-card') {
    if (Array.isArray(codes)) {
      const cleaned = codes.filter(c => typeof c === 'string' && c.trim()).map(c => c.trim().toUpperCase());
      if (cleaned.length === 0) {
        res.status(200).json({ giftCards: [] });
        return;
      }
      try {
        const { data, error } = await supabaseAdmin
          .from('gift_cards')
          .select('code, balance, expires_at')
          .in('code', cleaned);
        if (error) {
          console.error('lookup: gift-card batch query failed.', error.message);
          res.status(500).json({ error: 'Could not look up gift cards.' });
          return;
        }
        res.status(200).json({ giftCards: data || [] });
      } catch (err) {
        console.error('lookup: unexpected gift-card batch failure.', err?.message);
        res.status(500).json({ error: 'Could not look up gift cards.' });
      }
      return;
    }

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Missing gift card code.' });
      return;
    }
    try {
      const { data, error } = await supabaseAdmin
        .from('gift_cards')
        .select('code, balance, expires_at')
        .eq('code', code.trim().toUpperCase())
        .maybeSingle();
      if (error) {
        console.error('lookup: gift-card query failed.', error.message);
        res.status(500).json({ error: 'Could not look up gift card.' });
        return;
      }
      res.status(200).json({ giftCard: data || null });
    } catch (err) {
      console.error('lookup: unexpected gift-card failure.', err?.message);
      res.status(500).json({ error: 'Could not look up gift card.' });
    }
    return;
  }

  res.status(400).json({ error: 'Missing or invalid lookup type.' });
}
