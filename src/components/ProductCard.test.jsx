import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../context/CartContext', () => ({
  useCartActions: () => ({ addToCart: jest.fn() }),
  useCartData: () => ({ cart: [] }),
}));
jest.mock('../context/BrandContext', () => ({ useBrand: () => ({ brand: {} }) }));
jest.mock('../context/AuthContext', () => ({ useAuth: () => ({ currentUser: null }) }));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock('./BlurImage', () => ({ __esModule: true, default: (props) => <img data-testid="tile-img" src={props.src} style={props.style} alt={props.alt} /> }));

import ProductCard from './ProductCard';

let container;
let root;
const base = { id: 'p1', name: 'Cotton Kurta Set', price: 9000, cat: 'Women Ethnic', stock: 3, available: true, images: ['https://cdn.test/photo1.jpg', 'https://cdn.test/photo2.jpg'], image_position: '20% 30%' };

async function renderCard(product) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><ProductCard product={product} /></MemoryRouter>); });
  return container.querySelector('[data-testid=tile-img]');
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  root = null;
});

test('no video: the tile is the first photo with its custom alignment, no play badge (unchanged)', async () => {
  const img = await renderCard(base);
  expect(img.src).toContain('photo1.jpg');
  expect(img.style.objectPosition).toBe('20% 30%');
  expect(container.querySelector('[aria-label="Has video"]')).toBeNull();
});

test('video but no cover chosen: the tile still shows the first photo (unchanged)', async () => {
  const img = await renderCard({ ...base, video_url: 'https://cdn.test/v.mp4' });
  expect(img.src).toContain('photo1.jpg');
  expect(img.style.objectPosition).toBe('20% 30%');
  expect(container.querySelector('[aria-label="Has video"]')).toBeNull();
});

test('video + cover: the tile shows the cover first, with its own alignment and a play badge', async () => {
  const img = await renderCard({ ...base, video_url: 'https://cdn.test/v.mp4', video_cover_url: 'https://cdn.test/cover.jpg', video_cover_position: '70% 10%' });
  expect(img.src).toContain('cover.jpg');
  expect(img.style.objectPosition).toBe('70% 10%');
  expect(container.querySelector('[aria-label="Has video"]')).toBeTruthy();
});

test('cover without a saved position falls back to centered, not the photo alignment', async () => {
  const img = await renderCard({ ...base, video_url: 'https://cdn.test/v.mp4', video_cover_url: 'https://cdn.test/cover.jpg' });
  expect(img.style.objectPosition).toBe('50% 50%');
});

test('a cover with no video is ignored (the video is what makes it a video tile)', async () => {
  const img = await renderCard({ ...base, video_cover_url: 'https://cdn.test/cover.jpg' });
  expect(img.src).toContain('photo1.jpg');
  expect(container.querySelector('[aria-label="Has video"]')).toBeNull();
});
