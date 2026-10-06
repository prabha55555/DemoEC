import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mockUser = null;
let mockInsert;
let mockMine = null;
jest.mock('../context/AuthContext', () => ({ useAuth: () => ({ currentUser: mockUser, userProfile: { name: 'Asha' } }) }));
// (CRA resets jest mocks between tests, so the implementations are assigned in beforeEach.)
let mockFetchReviews;
jest.mock('../utils/catalogApi', () => ({ fetchReviews: (...a) => mockFetchReviews(...a) }));
jest.mock('../supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: mockMine }) }) }) }),
      insert: (row) => mockInsert(row),
    }),
  },
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

import ProductReviews, { ratingHistogram } from './ProductReviews';

const product = { id: 'p1', rating_avg: 4.3, rating_count: 2 };
let container; let root;
async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><ProductReviews product={product} /></MemoryRouter>); });
}
const find = (sel, text) => [...container.querySelectorAll(sel)].find(el => !text || el.textContent.includes(text));
const type = async (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
};

beforeEach(() => {
  mockFetchReviews = () => Promise.resolve([
    { id: 'r1', user_name: 'Ravi', rating: 5, title: 'Great', body: 'Loved it', verified_purchase: true, created_at: '2026-10-01T00:00:00Z' },
    { id: 'r2', user_name: 'Meena', rating: 3, title: '', body: 'Okay', verified_purchase: true, created_at: '2026-10-02T00:00:00Z' },
  ]);
  mockUser = null; mockMine = null; mockInsert = jest.fn(() => Promise.resolve({ error: null }));
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  root = null; container = null;
});

test('histogram counts reviews per star', () => {
  expect(ratingHistogram([{ rating: 5 }, { rating: 5 }, { rating: 2 }, { rating: 9 }])).toEqual({ 5: 2, 4: 0, 3: 0, 2: 1, 1: 0 });
});

test('shows the summary and the approved reviews', async () => {
  await render();
  expect(container.textContent).toContain('4.3');
  expect(container.textContent).toContain('2 ratings');
  expect(container.textContent).toContain('Loved it');
  expect(container.querySelectorAll('.rv-item')).toHaveLength(2);
  expect(container.textContent).toContain('Verified purchase');
});

test('a guest is asked to sign in, and sees no form', async () => {
  await render();
  const link = find('a', 'Sign in to write a review');
  expect(link.getAttribute('href')).toBe('/login');
  expect(container.querySelector('form')).toBeNull();
});

test('a signed-in customer can open the form and is told reviews follow delivery when the database refuses', async () => {
  mockUser = { id: 'u1', email: 'a@b.test', user_metadata: {} };
  mockInsert = jest.fn(() => Promise.resolve({ error: { code: '42501', message: 'new row violates row-level security policy' } }));
  await render();
  await act(async () => { find('button', 'Write a review').click(); });
  await act(async () => { find('[role=radio]', '').click(); });
  const stars = container.querySelectorAll('[role=radio]');
  await act(async () => { stars[3].click(); });
  await type(container.querySelector('#rv-body'), 'Good quality and fits well.');
  await act(async () => { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ product_id: 'p1', user_id: 'u1', rating: 4, status: 'pending', verified_purchase: true, user_name: 'Asha' }));
  expect(container.querySelector('[role=alert]').textContent).toBe('You can review a product after it has been delivered to you.');
});

test('a successful review is acknowledged as pending approval', async () => {
  mockUser = { id: 'u1', email: 'a@b.test', user_metadata: {} };
  await render();
  await act(async () => { find('button', 'Write a review').click(); });
  await act(async () => { container.querySelectorAll('[role=radio]')[4].click(); });
  await type(container.querySelector('#rv-body'), 'Excellent, would buy again.');
  await act(async () => { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(container.querySelector('.rv-note').textContent).toBe('Thanks! Your review will appear once approved.');
  expect(find('button', 'Write a review')).toBeUndefined();
});

test('a customer who already reviewed sees their review status instead of the form button', async () => {
  mockUser = { id: 'u1', email: 'a@b.test', user_metadata: {} };
  mockMine = { id: 'm1', status: 'pending', rating: 4 };
  await render();
  expect(find('button', 'Write a review')).toBeUndefined();
  expect(container.querySelector('.rv-note').textContent).toContain('appear once approved');
});

test('it requires a rating and a few words before sending', async () => {
  mockUser = { id: 'u1', email: 'a@b.test', user_metadata: {} };
  await render();
  await act(async () => { find('button', 'Write a review').click(); });
  await act(async () => { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(container.querySelector('[role=alert]').textContent).toContain('star rating');
  expect(mockInsert).not.toHaveBeenCalled();
});
