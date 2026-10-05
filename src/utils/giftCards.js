// SERVER-ONLY helpers for gift-card codes and balances. Every function takes the
// service-role Supabase client as its first argument so it can be unit-tested with a
// fake and so this file never imports a client of its own.
import crypto from 'crypto';

// No I, O, 0 or 1 -- a code read aloud or typed from a screenshot can't be misread.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols = 5 bits each

// BL-GC-XXXX-XXXX-XXXX: 12 random symbols = 60 bits, from the OS CSPRNG. Codes used to
// be minted in the browser with Math.random (about 31 bits) and stored as supplied.
export function generateGiftCode() {
  const bytes = crypto.randomBytes(12);
  let chars = '';
  for (let i = 0; i < 12; i += 1) chars += CODE_ALPHABET[bytes[i] % 32]; // 256 % 32 === 0, so no modulo bias
  return `BL-GC-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

const MAX_CAS_ATTEMPTS = 6;

function normalise(code) {
  return String(code || '').trim().toUpperCase();
}

// Atomically takes up to `cap` off a gift card's balance. `cap` is a CEILING --
// what the order actually needs (e.g. merchandise + shipping - discount), never a
// number derived from the card's own balance -- so a caller that read the balance
// once, earlier, can never bake a stale value into how much this call attempts to
// spend. The real spend is `min(current balance, cap)`, recomputed fresh on every
// loop iteration from a brand-new read; correctness does not depend on any database
// function: the UPDATE only succeeds while the balance still equals what was just
// read (compare-and-set), so two concurrent redemptions can never both spend the
// same money -- the loser re-reads, recomputes against the new balance, and retries.
//
// P0 fix: this used to take a fixed exact `amount` computed by the caller from a
// single outer read, then fail the ENTIRE redemption with INSUFFICIENT the moment
// a concurrent redemption had shrunk the real balance below that fixed number --
// even when a smaller, still-genuinely-available amount could have covered part of
// the order. A card with real balance is no longer ever dropped to "apply nothing"
// just because of a stale read; it's rejected only when nothing is left at all.
//
// Resolves to { ok: true, applied } (applied is the REAL amount just debited, which
// callers must use for their own accounting -- it may be less than `cap`) or
// { ok: false, reason } where reason is one of
//   NOT_FOUND | EXPIRED | INSUFFICIENT -- a definitive "this card cannot pay this"
//   ERROR                              -- a transient/database problem; safe to retry later
export async function redeemGiftCardBalance(supabase, rawCode, cap) {
  const code = normalise(rawCode);
  const ceiling = Number(cap);
  if (!code || !Number.isFinite(ceiling) || ceiling <= 0) return { ok: false, reason: 'ERROR', error: new Error('Invalid gift card redemption request.') };

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const { data: card, error } = await supabase.from('gift_cards').select('balance, expires_at').eq('code', code).maybeSingle();
    if (error) return { ok: false, reason: 'ERROR', error };
    if (!card) return { ok: false, reason: 'NOT_FOUND' };
    if (card.expires_at && new Date(card.expires_at) < new Date()) return { ok: false, reason: 'EXPIRED' };
    const balance = Number(card.balance);
    if (!Number.isFinite(balance) || balance <= 0) return { ok: false, reason: 'INSUFFICIENT' };
    const spend = Math.min(balance, ceiling);

    const { data: updated, error: updateError } = await supabase
      .from('gift_cards').update({ balance: balance - spend }).eq('code', code).eq('balance', card.balance).select('code');
    if (updateError) return { ok: false, reason: 'ERROR', error: updateError };
    if (Array.isArray(updated) && updated.length > 0) return { ok: true, applied: spend };
    // Someone else changed the balance between our read and write -- go round again.
  }
  return { ok: false, reason: 'ERROR', error: new Error('Gift card balance is under heavy contention.') };
}

// Puts `amount` back on a card after a redemption that had to be rolled back (a later
// step of the same order failed). Same compare-and-set loop; resolves to true/false.
export async function creditGiftCardBalance(supabase, rawCode, amount) {
  const code = normalise(rawCode);
  const back = Number(amount);
  if (!code || !Number.isFinite(back) || back <= 0) return false;

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const { data: card, error } = await supabase.from('gift_cards').select('balance').eq('code', code).maybeSingle();
    if (error || !card) return false;
    const balance = Number(card.balance);
    if (!Number.isFinite(balance)) return false;
    const { data: updated, error: updateError } = await supabase
      .from('gift_cards').update({ balance: balance + back }).eq('code', code).eq('balance', card.balance).select('code');
    if (updateError) return false;
    if (Array.isArray(updated) && updated.length > 0) return true;
  }
  return false;
}

// Creates one gift_cards row per purchased card with a freshly generated, server-chosen
// code. A code collision (unique violation) just draws a new code. Resolves to
// { ok: true, codes: [{ lineKey, code }] } or { ok: false } after removing anything it
// had already inserted for this order, so a failure never leaves a stray card behind.
export async function issueGiftCards(supabase, cards) {
  const issued = [];
  for (const card of cards) {
    let inserted = false;
    for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
      const code = generateGiftCode();
      const { error } = await supabase.from('gift_cards').insert({ ...card.row, code });
      if (!error) {
        issued.push({ lineKey: card.lineKey, code });
        inserted = true;
      } else if (error.code !== '23505') {
        console.error('gift_cards insert failed:', error);
        break;
      }
    }
    if (!inserted) {
      for (const done of issued) {
        const { error } = await supabase.from('gift_cards').delete().eq('code', done.code).eq('order_id', card.row.order_id);
        if (error) console.error('SECURITY/RECONCILIATION: could not remove a gift card issued for an order that then failed.', done.code, error);
      }
      return { ok: false };
    }
  }
  return { ok: true, codes: issued };
}
