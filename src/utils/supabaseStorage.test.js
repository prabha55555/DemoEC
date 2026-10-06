import { planImageUpload, staleMediaUrls, storagePathOf } from './supabaseStorage';

// supabaseStorage imports the real client at load; nothing here touches the network.
jest.mock('../supabase', () => ({ supabase: { storage: {} } }));

const MB = 1024 * 1024;

describe('planImageUpload', () => {
  test('small files and GIFs are uploaded untouched', () => {
    expect(planImageUpload({ type: 'image/png', size: 1 * MB, width: 4000, height: 3000, hasAlpha: true })).toEqual({ action: 'keep' });
    expect(planImageUpload({ type: 'image/gif', size: 9 * MB, width: 800, height: 600, hasAlpha: true })).toEqual({ action: 'keep' });
  });
  test('a big opaque photo is flattened to a JPEG and capped at 2400px', () => {
    expect(planImageUpload({ type: 'image/jpeg', size: 6 * MB, width: 4800, height: 3200 })).toEqual({ action: 'jpeg', width: 2400, height: 1600 });
    expect(planImageUpload({ type: 'image/png', size: 4 * MB, width: 2000, height: 1000, hasAlpha: false })).toEqual({ action: 'jpeg', width: 2000, height: 1000 });
  });
  test('a big PNG / WebP / AVIF with transparency is NEVER turned into a JPEG', () => {
    expect(planImageUpload({ type: 'image/png', size: 4 * MB, width: 2000, height: 1000, hasAlpha: true })).toEqual({ action: 'keep' });
    expect(planImageUpload({ type: 'image/webp', size: 4 * MB, width: 3000, height: 3000, hasAlpha: true })).toEqual({ action: 'resize', type: 'image/webp', width: 2400, height: 2400 });
    expect(planImageUpload({ type: 'image/png', size: 9 * MB, width: 5000, height: 2500, hasAlpha: true })).toEqual({ action: 'resize', type: 'image/png', width: 2400, height: 1200 });
    expect(planImageUpload({ type: 'image/avif', size: 3 * MB, width: 1000, height: 1000, hasAlpha: true })).toEqual({ action: 'keep' });
  });
});

describe('storagePathOf', () => {
  const base = 'https://x.supabase.co/storage/v1/object/public';
  test('extracts the object path for our bucket only', () => {
    expect(storagePathOf(`${base}/images/hero-slides/17-a.jpg`, 'images')).toBe('hero-slides/17-a.jpg');
    expect(storagePathOf(`${base}/images/hero-slides/17-a.jpg`, 'videos')).toBe('');
    expect(storagePathOf(`${base}/videos/brand/9-v.mp4`, 'videos')).toBe('brand/9-v.mp4');
  });
  test('ignores query strings and decodes percent-encoding; foreign URLs give nothing', () => {
    expect(storagePathOf(`${base}/images/a/b%20c.jpg?width=200`, 'images')).toBe('a/b c.jpg');
    expect(storagePathOf('https://res.cloudinary.com/x/image/upload/a.jpg', 'images')).toBe('');
    expect(storagePathOf(null, 'images')).toBe('');
  });
});

describe('staleMediaUrls', () => {
  test('returns the files that were replaced or removed', () => {
    expect(staleMediaUrls(['a.jpg', 'm.jpg'], ['b.jpg', 'm.jpg'])).toEqual(['a.jpg']);
    expect(staleMediaUrls(['a.jpg', 'm.jpg'], ['', ''])).toEqual(['a.jpg', 'm.jpg']);
  });
  test('handles galleries, empties and duplicates', () => {
    expect(staleMediaUrls([['a', 'b', 'c']], [['b']])).toEqual(['a', 'c']);
    expect(staleMediaUrls(['a', 'a'], [])).toEqual(['a']);
    expect(staleMediaUrls([null, undefined, ''], ['x'])).toEqual([]);
    expect(staleMediaUrls(['same'], ['same'])).toEqual([]);
  });
  test('the mobile banner image is covered when it is cleared', () => {
    expect(staleMediaUrls(['desk.jpg', 'mob.jpg'], ['desk.jpg', ''])).toEqual(['mob.jpg']);
  });
});
