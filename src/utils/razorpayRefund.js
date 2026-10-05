// SERVER-ONLY. Refunds a captured Razorpay payment in full. Used only when an order
// that was already paid for cannot be honoured (for example the gift card that was
// meant to cover part of it was spent by another order in the meantime), so the
// customer is never left charged with nothing to show for it.
export async function refundRazorpayPayment({ keyId, keySecret, paymentId, amountPaise, reason }) {
  if (!keyId || !keySecret) return { ok: false, error: 'Payment gateway is not configured.' };
  if (!/^pay_[A-Za-z0-9]+$/.test(String(paymentId || ''))) return { ok: false, error: 'Invalid payment id.' };
  const amount = Math.round(Number(amountPaise));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Invalid refund amount.' };

  try {
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
      body: JSON.stringify({ amount, speed: 'normal', notes: { reason: String(reason || 'Order could not be fulfilled').slice(0, 200) } }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, id: data?.id || null };
    const description = String(data?.error?.description || '');
    // A retry after a refund that already went through is a success, not a failure.
    if (/already.*refund|fully refunded|refund.*already/i.test(description)) return { ok: true, already: true };
    return { ok: false, error: description || `Razorpay responded with HTTP ${res.status}.` };
  } catch (err) {
    return { ok: false, error: err?.message || 'Could not reach Razorpay.' };
  }
}
