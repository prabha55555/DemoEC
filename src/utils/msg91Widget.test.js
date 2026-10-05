import { loadMsg91Script, openMsg91Widget, cancelMsg91Session, extractAccessToken, msg91Configured, __resetMsg91ForTests } from './msg91Widget';

const scripts = () => document.querySelectorAll('script#msg91-otp-provider');

beforeEach(() => {
  __resetMsg91ForTests();
  delete window.initSendOTP;
  document.body.innerHTML = '';
  process.env.REACT_APP_MSG91_WIDGET_ID = 'widget-id-test';
  process.env.REACT_APP_MSG91_WIDGET_TOKEN = 'token-test';
});

function finishLoad(ok = true) {
  const el = scripts()[0];
  if (ok) { window.initSendOTP = jest.fn(); el.dispatchEvent(new Event('load')); } else el.dispatchEvent(new Event('error'));
}

test('extractAccessToken tolerates the widget payload shapes', () => {
  expect(extractAccessToken({ message: 'abc' })).toBe('abc');
  expect(extractAccessToken('abc')).toBe('abc');
  expect(extractAccessToken({ token: 't' })).toBe('t');
  expect(extractAccessToken(null)).toBeNull();
  expect(extractAccessToken({ message: 5 })).toBeNull();
});

test('msg91Configured needs both public widget values', () => {
  expect(msg91Configured()).toBe(true);
  delete process.env.REACT_APP_MSG91_WIDGET_TOKEN;
  expect(msg91Configured()).toBe(false);
});

test('script tag is injected exactly once across repeated loads', async () => {
  const a = loadMsg91Script(); const b = loadMsg91Script(); const c = loadMsg91Script();
  expect(scripts().length).toBe(1);
  finishLoad();
  await Promise.all([a, b, c]);
  await loadMsg91Script();
  expect(scripts().length).toBe(1);
});

test('the backup host is tried when the first fails; only when both fail does loading reject', async () => {
  const p = loadMsg91Script();
  expect(scripts()[0].src).toContain('verify.msg91.com');
  finishLoad(false);
  expect(scripts().length).toBe(1);
  expect(scripts()[0].src).toContain('verify.phone91.com');
  finishLoad();
  await p;
});

test('script load failure on both hosts rejects, removes the dead tag, and a retry works', async () => {
  const p = loadMsg91Script();
  finishLoad(false);
  finishLoad(false);
  await expect(p).rejects.toThrow();
  expect(scripts().length).toBe(0);
  const p2 = loadMsg91Script();
  expect(scripts().length).toBe(1);
  finishLoad();
  await p2;
});

test('widget is initialised once; a second open while one is active does not re-init', async () => {
  const onToken = jest.fn(); const onError = jest.fn();
  const first = openMsg91Widget({ onToken, onError });
  finishLoad();
  expect(await first).toBe(true);
  expect(window.initSendOTP).toHaveBeenCalledTimes(1);
  expect(await openMsg91Widget({ onToken, onError })).toBe(false);
  expect(await openMsg91Widget({ onToken, onError })).toBe(false);
  expect(window.initSendOTP).toHaveBeenCalledTimes(1);
  const cfg = window.initSendOTP.mock.calls[0][0];
  expect(cfg.exposeMethods).toBe(false);
  expect(cfg.widgetId).toBe('widget-id-test');
});

test('success delivers the token once, then a new session may start', async () => {
  const onToken = jest.fn(); const onError = jest.fn();
  const p = openMsg91Widget({ onToken, onError }); finishLoad(); await p;
  const cfg = window.initSendOTP.mock.calls[0][0];
  cfg.success({ message: 'jwt-token-value' });
  cfg.success({ message: 'jwt-token-value' }); // duplicate callback ignored
  expect(onToken).toHaveBeenCalledTimes(1);
  expect(onToken).toHaveBeenCalledWith('jwt-token-value');
  expect(await openMsg91Widget({ onToken, onError })).toBe(true);
  expect(window.initSendOTP).toHaveBeenCalledTimes(2);
});

test('verification failure is reported and allows a retry', async () => {
  const onToken = jest.fn(); const onError = jest.fn();
  const p = openMsg91Widget({ onToken, onError }); finishLoad(); await p;
  window.initSendOTP.mock.calls[0][0].failure({ message: 'bad otp' });
  expect(onError).toHaveBeenCalledWith('verification_failed');
  expect(onToken).not.toHaveBeenCalled();
  expect(await openMsg91Widget({ onToken, onError })).toBe(true);
});

test('initialisation failure is handled', async () => {
  const onToken = jest.fn(); const onError = jest.fn();
  const p = openMsg91Widget({ onToken, onError });
  const el = scripts()[0]; window.initSendOTP = jest.fn(() => { throw new Error('boom'); }); el.dispatchEvent(new Event('load'));
  expect(await p).toBe(false);
  expect(onError).toHaveBeenCalledWith('init_failed');
});

test('script failure is reported', async () => {
  const onToken = jest.fn(); const onError = jest.fn();
  const p = openMsg91Widget({ onToken, onError }); finishLoad(false); finishLoad(false);
  expect(await p).toBe(false);
  expect(onError).toHaveBeenCalledWith('script_failed');
});

test('leaving the page cancels the session: a late success is ignored', async () => {
  const onToken = jest.fn(); const onError = jest.fn();
  const p = openMsg91Widget({ onToken, onError }); finishLoad(); await p;
  const cfg = window.initSendOTP.mock.calls[0][0];
  cancelMsg91Session();
  cfg.success({ message: 'late-token' }); cfg.failure({});
  expect(onToken).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

test('leaving while the script is still loading never initialises the widget', async () => {
  const onToken = jest.fn(); const onError = jest.fn();
  const p = openMsg91Widget({ onToken, onError });
  cancelMsg91Session(); finishLoad();
  expect(await p).toBe(false);
  expect(window.initSendOTP).not.toHaveBeenCalled();
});

test('missing configuration reports not_configured without loading anything', async () => {
  delete process.env.REACT_APP_MSG91_WIDGET_ID;
  const onError = jest.fn();
  expect(await openMsg91Widget({ onToken: jest.fn(), onError })).toBe(false);
  expect(onError).toHaveBeenCalledWith('not_configured');
  expect(scripts().length).toBe(0);
});
