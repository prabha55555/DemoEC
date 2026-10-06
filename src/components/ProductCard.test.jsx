import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockQuickAdd = jest.fn();
const mockToggle = jest.fn();
let mockSaved = new Set();
jest.mock('../context/CartContext', () => ({ useCartActions: () => ({ quickAdd: mockQuickAdd }) }));
jest.mock('../context/WishlistContext', () => ({ useWishlist: () => ({ has: (id) => mockSaved.has(id), toggle: mockToggle, ids: mockSaved, count: mockSaved.size }) }));
jest.mock('./BlurImage', () => ({ __esModule: true, default: (props) => <img data-testid="tile-img" src={props.src} style={props.style} alt={props.alt} /> }));

import ProductCard from './ProductCard';

let container;
let root;
// A LIST_COLUMNS row: a simple product (one 'Default' variant, no options).
const base = {
  id: 'p1', name: 'Ceramic Table Lamp', brand: 'Hearth & Co', cat: 'Home Decor', price: 1299, price_max: 1299, mrp: 1599, discount_pct: 19,
  in_stock: true, has_variants: false, badge: 'Bestseller', rating_avg: 4.2, rating_count: 85,
  images: ['https://cdn.test/photo1.jpg', 'https://cdn.test/photo2.jpg'], image_position: '20% 30%',
};

async function renderCard(product) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><ProductCard product={product} /></MemoryRouter>); });
  return container.querySelector('[data-testid=tile-img]');
}
const text = () => container.textContent;
const buttonLabelled = (label) => [...container.querySelectorAll('button, a')].find(el => el.textContent.trim() === label);

beforeEach(() => { mockQuickAdd.mockReset(); mockToggle.mockReset(); mockSaved = new Set(); });
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  root = null;
});

test('shows brand, name, price, struck-through MRP and the discount', async () => {
  await renderCard(base);
  expect(text()).toContain('Hearth & Co');
  expect(text()).toContain('Ceramic Table Lamp');
  expect(container.querySelector('.pb-now').textContent).toBe('₹1,299');
  expect(container.querySelector('.pb-mrp s').textContent).toBe('₹1,599');
  expect(container.querySelector('.pb-off').textContent).toBe('19% off');
  expect(text()).not.toContain('from');
});

test('a single merchandising badge shows on the image, never the automatic % chip twice', async () => {
  await renderCard(base);
  const badges = container.querySelectorAll('.bl-pcard-badges .badge');
  expect(badges).toHaveLength(1);
  expect(badges[0].textContent).toBe('Bestseller');
});

test('the image is contained (not cropped) and uses the product image', async () => {
  const img = await renderCard(base);
  expect(img.src).toContain('photo1.jpg');
  expect(img.style.objectFit).toBe('contain');
  expect(img.style.objectPosition).toBe('20% 30%');
});

test('ratings show with a count, and are hidden when the product has none', async () => {
  await renderCard(base);
  expect(container.querySelector('.star-rating')).toBeTruthy();
  expect(text()).toContain('(85)');
  await act(async () => root.unmount());
  container.remove();
  await renderCard({ ...base, rating_avg: 0, rating_count: 0 });
  expect(container.querySelector('.star-rating')).toBeNull();
});

test('a product without options is added straight from the card', async () => {
  mockQuickAdd.mockResolvedValue({ added: true });
  await renderCard(base);
  await act(async () => { buttonLabelled('Add to cart').click(); });
  expect(mockQuickAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
  expect(buttonLabelled('Added ✓')).toBeTruthy();
});

test('a product with options links to its page and never picks a size', async () => {
  await renderCard({ ...base, id: 'p2', has_variants: true, price: 799, price_max: 899, mrp: 899, option_types: [{ name: 'Size', values: ['S', 'M'] }] });
  const link = buttonLabelled('Select options');
  expect(link.tagName).toBe('A');
  expect(link.getAttribute('href')).toBe('/product/p2');
  expect(buttonLabelled('Add to cart')).toBeUndefined();
  expect(container.querySelector('.pb-prefix').textContent).toBe('from');
  expect(mockQuickAdd).not.toHaveBeenCalled();
});

test('"from" is only for a real price range, not for options that all cost the same', async () => {
  await renderCard({ ...base, has_variants: true, price: 799, price_max: 799, mrp: 899 });
  expect(container.querySelector('.pb-prefix')).toBeNull();
});

test('out of stock: dimmed with a label, no add button, no merchandising badge', async () => {
  await renderCard({ ...base, in_stock: false });
  expect(container.querySelector('.bl-pcard').className).toContain('is-out');
  expect(container.querySelector('.bl-pcard-soldmask').textContent).toBe('Out of stock');
  expect(buttonLabelled('Add to cart')).toBeUndefined();
  expect(buttonLabelled('View details').getAttribute('href')).toBe('/product/p1');
  expect(container.querySelector('.bl-pcard-badges')).toBeNull();
});

test('"Free delivery" appears only when the product itself ships free', async () => {
  await renderCard(base);
  expect(text()).not.toContain('Free delivery');
  await act(async () => root.unmount());
  container.remove();
  await renderCard({ ...base, free_shipping: true });
  expect(text()).toContain('Free delivery');
});

test('no enquiry / WhatsApp / price-on-request elements', async () => {
  await renderCard(base);
  expect(text().toLowerCase()).not.toMatch(/whatsapp|enquir|on request|collector/);
});

test('the heart toggles the wishlist by product id', async () => {
  await renderCard(base);
  await act(async () => { container.querySelector('.bl-pcard-wish').click(); });
  expect(mockToggle).toHaveBeenCalledWith('p1');
});

test('the heart reflects a saved product', async () => {
  mockSaved = new Set(['p1']);
  await renderCard(base);
  const heart = container.querySelector('.bl-pcard-wish');
  expect(heart.getAttribute('aria-pressed')).toBe('true');
  expect(heart.className).toContain('is-on');
});

test('video but no cover chosen: the tile is still the first photo, no play badge', async () => {
  const img = await renderCard({ ...base, video_url: 'https://cdn.test/v.mp4' });
  expect(img.src).toContain('photo1.jpg');
  expect(container.querySelector('[aria-label="Has video"]')).toBeNull();
});

test('video + cover: the tile shows the cover with its own alignment and a play badge', async () => {
  const img = await renderCard({ ...base, video_url: 'https://cdn.test/v.mp4', video_cover_url: 'https://cdn.test/cover.jpg', video_cover_position: '70% 10%' });
  expect(img.src).toContain('cover.jpg');
  expect(img.style.objectPosition).toBe('70% 10%');
  expect(container.querySelector('[aria-label="Has video"]')).toBeTruthy();
});

test('a cover with no video is ignored', async () => {
  const img = await renderCard({ ...base, video_cover_url: 'https://cdn.test/cover.jpg' });
  expect(img.src).toContain('photo1.jpg');
  expect(container.querySelector('[aria-label="Has video"]')).toBeNull();
});
