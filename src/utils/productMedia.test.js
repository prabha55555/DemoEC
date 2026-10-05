import { buildProductMedia, clampVideoPosition, photoIndexFromMerged, mergedIndexFromPhoto } from './productMedia';

const photos = ['A', 'B', 'C', 'D'];

test('no video: media is exactly the photos in order', () => {
  expect(buildProductMedia(photos, null, 0)).toEqual(photos.map(url => ({ type: 'image', url })));
  expect(buildProductMedia(photos, '', 2)).toEqual(photos.map(url => ({ type: 'image', url })));
});

test('video leads (position 0), matching the previous fixed behavior', () => {
  expect(buildProductMedia(photos, 'V', 0)).toEqual([{ type: 'video', url: 'V' }, ...photos.map(url => ({ type: 'image', url }))]);
});

test('video placed in the middle', () => {
  expect(buildProductMedia(photos, 'V', 2)).toEqual([
    { type: 'image', url: 'A' }, { type: 'image', url: 'B' },
    { type: 'video', url: 'V' },
    { type: 'image', url: 'C' }, { type: 'image', url: 'D' },
  ]);
});

test('video trails everything', () => {
  expect(buildProductMedia(photos, 'V', 4)).toEqual([...photos.map(url => ({ type: 'image', url })), { type: 'video', url: 'V' }]);
});

test('clampVideoPosition keeps a stale/out-of-range position sane', () => {
  expect(clampVideoPosition(99, 4)).toBe(4);
  expect(clampVideoPosition(-3, 4)).toBe(0);
  expect(clampVideoPosition(undefined, 4)).toBe(0);
  expect(clampVideoPosition('2', 4)).toBe(2);
  expect(buildProductMedia(photos, 'V', 99)).toEqual([...photos.map(url => ({ type: 'image', url })), { type: 'video', url: 'V' }]);
});

test('photoIndexFromMerged / mergedIndexFromPhoto round-trip for every position, video absent', () => {
  for (let i = 0; i < photos.length; i++) {
    expect(photoIndexFromMerged(i, false, 0)).toBe(i);
    expect(mergedIndexFromPhoto(i, false, 0)).toBe(i);
  }
});

test('photoIndexFromMerged / mergedIndexFromPhoto round-trip with the video at every possible position', () => {
  for (let videoPos = 0; videoPos <= photos.length; videoPos++) {
    const media = buildProductMedia(photos, 'V', videoPos);
    for (let photoIdx = 0; photoIdx < photos.length; photoIdx++) {
      const merged = mergedIndexFromPhoto(photoIdx, true, videoPos);
      expect(media[merged]).toEqual({ type: 'image', url: photos[photoIdx] }); // lands on the right photo
      expect(photoIndexFromMerged(merged, true, videoPos)).toBe(photoIdx); // and maps straight back
    }
    // the merged index that IS the video itself never claims to be a photo index a caller would reuse
    // as a valid photos[] lookup for any OTHER photo -- i.e. it's exactly the one "seam" index.
    expect(media[videoPos]).toEqual({ type: 'video', url: 'V' });
  }
});
