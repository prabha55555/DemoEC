import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, useLocation } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mockAuthCallback;
const mockFromCalls = [];
const mockSignInOAuth = jest.fn();
let mockProfileExists = true;
const mockProfileWrites = [];
jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: (cb) => { mockAuthCallback = cb; return { data: { subscription: { unsubscribe: jest.fn() } } }; },
      signInWithOAuth: (...a) => mockSignInOAuth(...a),
      signInWithPassword: async () => ({ data: {}, error: null }),
    },
    from: (table) => {
      mockFromCalls.push(table);
      const q = { select: () => q, eq: () => q, insert: async () => ({ error: null }), upsert: async (row, opts) => { mockProfileWrites.push({ row, opts }); return { error: null }; }, maybeSingle: async () => { await new Promise(r => setTimeout(r, 15)); return { data: mockProfileExists ? { id: 'u1' } : null, error: null }; }, single: async () => ({ data: { id: 'u1', name: 'Asha', addresses: [] }, error: null }) };
      return q;
    },
  },
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

import { AuthProvider, isInternalReturnPath, useAuth } from './AuthContext';

let container, root, auth, where;
function Probe() {
  auth = useAuth();
  where = useLocation();
  return <div id="who">{auth.currentUser?.id || 'nobody'}</div>;
}
const user = { id: 'u1', email: 'a@b.co', updated_at: 't1', app_metadata: {} };
const mount = async () => {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter initialEntries={['/']}><AuthProvider><Probe /></AuthProvider></MemoryRouter>); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};

beforeEach(() => { sessionStorage.clear(); mockFromCalls.length = 0; mockProfileExists = true; mockProfileWrites.length = 0; mockSignInOAuth.mockResolvedValue({ error: null }); }); // CRA resets mock implementations between tests
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); root = null; });

test('only same-site paths are accepted as a return target', () => {
  expect(isInternalReturnPath('/checkout?x=1')).toBe(true);
  expect(isInternalReturnPath('//evil.example')).toBe(false);
  expect(isInternalReturnPath('https://evil.example')).toBe(false);
  expect(isInternalReturnPath('/\\evil.example')).toBe(false);
  expect(isInternalReturnPath(undefined)).toBe(false);
});

test('Google sign-in parks the page the customer came from before redirecting away', async () => {
  await mount();
  await act(async () => { await auth.loginWithGoogle('/checkout?step=2'); });
  expect(JSON.parse(sessionStorage.getItem('tt_after_login')).path).toBe('/checkout?step=2');
  expect(mockSignInOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google' }));
});

test('an unsafe return target is never stored', async () => {
  await mount();
  await act(async () => { await auth.loginWithGoogle('//evil.example/x'); });
  expect(sessionStorage.getItem('tt_after_login')).toBeNull();
});

test('after the OAuth round trip the customer is sent back to where they were, once', async () => {
  sessionStorage.setItem('tt_after_login', JSON.stringify({ path: '/checkout', ts: Date.now() }));
  await mount();
  await act(async () => { mockAuthCallback('SIGNED_IN', { user }); });
  expect(where.pathname).toBe('/checkout');
  expect(sessionStorage.getItem('tt_after_login')).toBeNull();
});

test('a stale parked path (older than 10 minutes) is ignored', async () => {
  sessionStorage.setItem('tt_after_login', JSON.stringify({ path: '/checkout', ts: Date.now() - 11 * 60 * 1000 }));
  await mount();
  await act(async () => { mockAuthCallback('SIGNED_IN', { user }); });
  expect(where.pathname).toBe('/');
});

test('the auth callback itself makes no Supabase call (profile work is deferred out of the callback)', async () => {
  await mount();
  mockFromCalls.length = 0;
  let during;
  await act(async () => {
    mockAuthCallback('SIGNED_IN', { user });
    during = mockFromCalls.length;           // synchronous part of the callback
    await new Promise(r => setTimeout(r, 20)); // deferred work runs on the next tick
  });
  expect(during).toBe(0);
  expect(mockFromCalls).toContain('profiles');
  expect(document.getElementById('who').textContent).toBe('u1');
});

test('a token refresh keeps the same user object (no needless re-renders downstream)', async () => {
  await mount();
  await act(async () => { mockAuthCallback('SIGNED_IN', { user }); await new Promise(r => setTimeout(r, 20)); });
  const first = auth.currentUser;
  await act(async () => { mockAuthCallback('TOKEN_REFRESHED', { user: { ...user } }); });
  expect(auth.currentUser).toBe(first);
});

test('a missing profile is created once, with a conflict-safe insert (another tab may be signing in too)', async () => {
  mockProfileExists = false;
  await mount();
  await act(async () => {
    mockAuthCallback('SIGNED_IN', { user });
    mockAuthCallback('SIGNED_IN', { user });          // the session bootstrap and the auth event land together
    await new Promise(r => setTimeout(r, 120));
  });
  expect(mockProfileWrites).toHaveLength(1);
  expect(mockProfileWrites[0].opts).toMatchObject({ onConflict: 'id', ignoreDuplicates: true });
  expect(mockProfileWrites[0].row.id).toBe('u1');
});

test('an existing profile is never rewritten', async () => {
  mockProfileExists = true;
  await mount();
  await act(async () => { mockAuthCallback('SIGNED_IN', { user }); await new Promise(r => setTimeout(r, 60)); });
  expect(mockProfileWrites).toHaveLength(0);
});
