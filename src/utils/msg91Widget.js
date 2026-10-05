// Thin loader for MSG91's DEFAULT-UI OTP widget (verify.msg91.com/otp-provider.js). The widget
// itself renders the mobile-number / OTP / resend / CAPTCHA UI; this file only (a) loads its script
// exactly once per page session, (b) starts one widget session at a time, and (c) hands the resulting
// access token to a callback. The token is passed straight through -- never logged or stored here.
// MSG91's own snippet tries the second host if the first cannot be reached.
const SCRIPT_SRCS = ['https://verify.msg91.com/otp-provider.js', 'https://verify.phone91.com/otp-provider.js'];
const SCRIPT_ID = 'msg91-otp-provider';

let scriptPromise = null;
let activeSession = null; // { onToken, onError } for the widget session currently allowed to answer
let widgetOpen = false;

export function msg91Configured() {
  return !!(process.env.REACT_APP_MSG91_WIDGET_ID && process.env.REACT_APP_MSG91_WIDGET_TOKEN);
}

// Loads the provider script once. A failed load clears its own state (and removes the dead tag) so the
// customer can simply try again; concurrent/repeated calls share one <script> element.
export function loadMsg91Script() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (typeof window.initSendOTP === 'function') return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    let index = 0;
    const fail = () => {
      scriptPromise = null;
      document.getElementById(SCRIPT_ID)?.remove();
      reject(new Error('MSG91 script failed to load'));
    };
    const attempt = () => {
      document.getElementById(SCRIPT_ID)?.remove(); // never more than one provider tag in the page
      const el = document.createElement('script');
      el.id = SCRIPT_ID;
      el.src = SCRIPT_SRCS[index];
      el.async = true;
      el.addEventListener('load', () => (typeof window.initSendOTP === 'function' ? resolve() : fail()), { once: true });
      el.addEventListener('error', () => { index += 1; if (index < SCRIPT_SRCS.length) attempt(); else fail(); }, { once: true });
      document.body.appendChild(el);
    };
    attempt();
  });
  return scriptPromise;
}

// The widget's success payload carries the signed access token; be tolerant about its exact shape.
export function extractAccessToken(data) {
  if (typeof data === 'string') return data;
  if (!data || typeof data !== 'object') return null;
  const candidate = data.message ?? data.token ?? data['access-token'] ?? data.accessToken;
  return typeof candidate === 'string' ? candidate : null;
}

export function msg91WidgetOpen() { return widgetOpen; }

// Ignore any later answer from a widget session the page no longer cares about (leaving /login,
// starting a new attempt). Does not, and cannot, close MSG91's own popup.
export function cancelMsg91Session() {
  activeSession = null;
  widgetOpen = false;
}

// Starts ONE widget session. Unless `force` is set, a session that is still open is left alone -- so a
// double tap or a re-render can never initialise a second widget. `force` is only for the explicit
// "reopen" action after the customer has closed the popup.
export async function openMsg91Widget({ onToken, onError, force = false }) {
  if (widgetOpen && !force) return false;
  const widgetId = process.env.REACT_APP_MSG91_WIDGET_ID;
  const tokenAuth = process.env.REACT_APP_MSG91_WIDGET_TOKEN;
  if (!widgetId || !tokenAuth) { onError('not_configured'); return false; }

  const session = { onToken, onError };
  activeSession = session;
  widgetOpen = true;
  try {
    await loadMsg91Script();
  } catch {
    if (activeSession === session) { widgetOpen = false; activeSession = null; onError('script_failed'); }
    return false;
  }
  if (activeSession !== session) return false; // navigated away / superseded while loading

  try {
    window.initSendOTP({
      widgetId,
      tokenAuth,
      exposeMethods: false, // default UI: MSG91 shows its own popup
      success: (data) => {
        if (activeSession !== session) return;
        widgetOpen = false; activeSession = null;
        const token = extractAccessToken(data);
        if (token) onToken(token); else onError('no_token');
      },
      failure: () => {
        if (activeSession !== session) return;
        widgetOpen = false; activeSession = null;
        onError('verification_failed');
      },
    });
  } catch {
    if (activeSession === session) { widgetOpen = false; activeSession = null; onError('init_failed'); }
    return false;
  }
  return true;
}

// Test-only reset of module state.
export function __resetMsg91ForTests() {
  scriptPromise = null; activeSession = null; widgetOpen = false;
}
