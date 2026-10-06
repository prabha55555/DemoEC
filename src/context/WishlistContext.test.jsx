import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// What the fake database holds: the products that still exist, and the wishlist rows already saved for the user.
let mockLiveProducts = [];
let mockSavedRows = [];
const mockUpserts = [];

jest.mock('../supabase', () => ({
  supabase: {
    from: (table) => {
      const q = {
        select: () => q,
        eq: () => q,
        in: (col, ids) => (table === 'products'
          ? Promise.resolve({ data: mockLiveProducts.filter(id => ids.includes(id)).map(id => ({ id })), error: null })
          : q),
        upsert: async (rows, opts) => { mockUpserts.push({ rows, opts }); return { error: null }; },
        insert: async () => ({ error: null }),
        delete: () => q,
        then: (resolve) => resolve({ data: table === 'wishlists' ? mockSavedRows : [], error: null }),
      };
      return q;
    },
  },
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock('./AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'u1' } }) }));

import { WishlistProvider, useWishlist } from './WishlistContext';

let container, root, wishlist;
function Probe() { wishlist = useWishlist(); return <div>{[...wishlist.ids].join(',')}</div>; }
const mount = async () => {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<WishlistProvider><Probe /></WishlistProvider>); });
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
};

beforeEach(() => { localStorage.clear(); mockUpserts.length = 0; mockLiveProducts = []; mockSavedRows = []; });
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); root = null; });

test('signing in merges a guest list into the account', async () => {
  localStorage.setItem('tt_wl2', JSON.stringify(['p-new']));
  mockLiveProducts = ['p-new', 'p-saved'];
  mockSavedRows = [{ product_id: 'p-saved' }];
  await mount();
  expect(mockUpserts).toHaveLength(1);
  expect(mockUpserts[0].rows).toEqual([{ user_id: 'u1', product_id: 'p-new' }]);
  expect([...wishlist.ids].sort()).toEqual(['p-new', 'p-saved']);
});

test('a saved product that no longer exists is dropped instead of failing the whole merge', async () => {
  localStorage.setItem('tt_wl2', JSON.stringify(['gone', 'p-ok']));
  mockLiveProducts = ['p-ok'];                              // "gone" was deleted from the catalogue
  await mount();
  // only the valid item is sent -- one stale id would break the foreign key and lose BOTH
  expect(mockUpserts).toHaveLength(1);
  expect(mockUpserts[0].rows.map(r => r.product_id)).toEqual(['p-ok']);
  expect(mockUpserts[0].opts).toMatchObject({ onConflict: 'user_id,product_id', ignoreDuplicates: true });
  expect([...wishlist.ids]).toEqual(['p-ok']);
  expect(JSON.parse(localStorage.getItem('tt_wl2'))).toEqual(['p-ok']);   // and the browser copy is cleaned up
});

test('nothing is sent when the guest list is empty or already saved', async () => {
  mockSavedRows = [{ product_id: 'p1' }];
  mockLiveProducts = ['p1'];
  await mount();
  expect(mockUpserts).toHaveLength(0);
  expect([...wishlist.ids]).toEqual(['p1']);
});
