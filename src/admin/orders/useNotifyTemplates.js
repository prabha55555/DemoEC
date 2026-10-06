import { useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { withTimeout } from '../../utils/withTimeout';

// Which ENABLED message templates the server would use for an order event. api/orders picks, per channel:
//   email     the first enabled template of the event, system template first, then oldest
//   whatsapp  the one enabled template of the event
// Looked up here only to tell the admin what will go out BEFORE they press the button (the answer is cached for 30 s, so
// opening a dialog twice does not query twice).
const cache = new Map();
const TTL = 30000;

export async function fetchNotifyTemplates(eventType) {
  if (!eventType) return { email: null, whatsapp: null, failed: false };
  const hit = cache.get(eventType);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  let value;
  try {
    const [email, wa] = await Promise.all([
      withTimeout(supabase.from('email_templates').select('id, name').eq('event_type', eventType).eq('enabled', true)
        .order('is_system', { ascending: false }).order('created_at', { ascending: true }).limit(1), 10000),
      withTimeout(supabase.from('whatsapp_templates').select('id, name').eq('event_type', eventType).eq('enabled', true).limit(1), 10000),
    ]);
    value = { email: email.data?.[0] || null, whatsapp: wa.data?.[0] || null, failed: !!(email.error || wa.error) };
  } catch {
    value = { email: null, whatsapp: null, failed: true };
  }
  if (!value.failed) cache.set(eventType, { at: Date.now(), value });
  return value;
}

// useNotifyTemplates('ORDER_SHIPPED') -> { loading, templates: { email, whatsapp, failed } }
export default function useNotifyTemplates(eventType) {
  const [state, setState] = useState({ loading: !!eventType, templates: { email: null, whatsapp: null, failed: false } });
  useEffect(() => {
    if (!eventType) { setState({ loading: false, templates: { email: null, whatsapp: null, failed: false } }); return undefined; }
    let cancelled = false;
    setState(s => ({ ...s, loading: true }));
    fetchNotifyTemplates(eventType).then(templates => { if (!cancelled) setState({ loading: false, templates }); });
    return () => { cancelled = true; };
  }, [eventType]);
  return state;
}
