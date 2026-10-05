import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../utils/supabaseStorage', () => ({ uploadToStorage: jest.fn(), ALLOWED_IMAGE_ACCEPT: 'image/*' }));

import ImageUploader from './ImageUploader';

let container;
let root;
const photos = ['A.jpg', 'B.jpg', 'C.jpg'];

async function renderUploader(props) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<ImageUploader images={photos} onChange={props.onChange || jest.fn()} video={props.video} />); });
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  root = null;
});
const videoTile = () => container.querySelector('video');
const tiles = () => container.querySelectorAll('img, video');

test('no video prop: renders exactly the photo tiles, unaffected (existing behavior)', async () => {
  await renderUploader({});
  expect(tiles().length).toBe(photos.length);
  expect(videoTile()).toBeNull();
});

test('video at position 0: shown first, labeled "Opens First", only a right arrow', async () => {
  const onVideoPositionChange = jest.fn();
  await renderUploader({ video: { videoUrl: 'V.mp4', videoPosition: 0, onVideoPositionChange } });
  expect(tiles().length).toBe(photos.length + 1);
  expect(tiles()[0].tagName).toBe('VIDEO');
  expect(container.textContent).toMatch(/opens first/i);
  expect(container.querySelector('[aria-label="Move video left"]')).toBeNull();
  const right = container.querySelector('[aria-label="Move video right"]');
  expect(right).toBeTruthy();
  await act(async () => right.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(onVideoPositionChange).toHaveBeenCalledWith(1);
});

test('video in the middle: photo tiles on both sides, both video arrows present', async () => {
  const onVideoPositionChange = jest.fn();
  await renderUploader({ video: { videoUrl: 'V.mp4', videoPosition: 1, onVideoPositionChange } });
  const t = tiles();
  expect(t[0].tagName).toBe('IMG'); expect(t[0].src).toContain('A.jpg');
  expect(t[1].tagName).toBe('VIDEO');
  expect(t[2].tagName).toBe('IMG'); expect(t[2].src).toContain('B.jpg');
  expect(t[3].tagName).toBe('IMG'); expect(t[3].src).toContain('C.jpg');
  await act(async () => container.querySelector('[aria-label="Move video left"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(onVideoPositionChange).toHaveBeenCalledWith(0);
  await act(async () => container.querySelector('[aria-label="Move video right"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(onVideoPositionChange).toHaveBeenLastCalledWith(2);
});

test('video trailing all photos: only a left arrow, first photo keeps "Main Photo"', async () => {
  await renderUploader({ video: { videoUrl: 'V.mp4', videoPosition: photos.length, onVideoPositionChange: jest.fn() } });
  const t = tiles();
  expect(t[t.length - 1].tagName).toBe('VIDEO');
  expect(container.querySelector('[aria-label="Move video right"]')).toBeNull();
  expect(container.querySelector('[aria-label="Move video left"]')).toBeTruthy();
  expect(container.textContent).toMatch(/main photo/i);
});

test('reordering photos around the video works by real image index, not merged position', async () => {
  const onChange = jest.fn();
  await renderUploader({ video: { videoUrl: 'V.mp4', videoPosition: 1, onVideoPositionChange: jest.fn() }, onChange });
  // B.jpg (real index 1, sits right after the video) moves left, swapping across the video's position.
  const moveLeftButtons = container.querySelectorAll('[aria-label^="Move image"][aria-label$="left"]');
  const bsButton = [...moveLeftButtons].find(b => b.getAttribute('aria-label') === 'Move image 2 left');
  await act(async () => bsButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(onChange).toHaveBeenCalledWith(['B.jpg', 'A.jpg', 'C.jpg']);
});

test('the video tile has no remove control (its URL is managed elsewhere)', async () => {
  await renderUploader({ video: { videoUrl: 'V.mp4', videoPosition: 0, onVideoPositionChange: jest.fn() } });
  expect(container.querySelector('[aria-label="Remove video"]')).toBeNull();
});

// Regression: under React.StrictMode (the dev server) the unmount-cleanup used to leave the
// "still mounted" flag false forever, so a finished upload was dropped and the button stuck on
// "Uploading... 0%". The upload must complete and attach its photo exactly as in production.
test('upload completes and attaches the photo under React.StrictMode', async () => {
  const { uploadToStorage } = require('../utils/supabaseStorage');
  uploadToStorage.mockResolvedValueOnce('NEW.jpg');
  const onChange = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<React.StrictMode><ImageUploader images={photos} onChange={onChange} /></React.StrictMode>); });
  const input = container.querySelector('input[type="file"]');
  const file = new File(['x'], 'shirt.jpg', { type: 'image/jpeg' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(uploadToStorage).toHaveBeenCalledWith(file, 'products');
  expect(onChange).toHaveBeenCalledWith([...photos, 'NEW.jpg']);
  expect(container.textContent).not.toMatch(/uploading/i);
});
