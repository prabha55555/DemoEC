import { mapWithConcurrency } from './pool';

test('never runs more than `limit` workers at once and keeps result order', async () => {
  let running = 0; let peak = 0;
  const worker = async (n) => {
    running += 1; peak = Math.max(peak, running);
    await new Promise(r => setTimeout(r, 5 + (n % 3)));
    running -= 1;
    return n * 2;
  };
  const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, worker);
  expect(peak).toBe(3);
  expect(results.map(r => r.value)).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  expect(results.every(r => r.status === 'fulfilled')).toBe(true);
});

test('one failure does not stop the others and is reported in place', async () => {
  const results = await mapWithConcurrency(['a', 'bad', 'c'], 2, async (x) => { if (x === 'bad') throw new Error('nope'); return x.toUpperCase(); });
  expect(results[0]).toEqual({ status: 'fulfilled', value: 'A' });
  expect(results[1].status).toBe('rejected');
  expect(results[1].reason.message).toBe('nope');
  expect(results[2]).toEqual({ status: 'fulfilled', value: 'C' });
});

test('empty input and tiny limits are fine', async () => {
  expect(await mapWithConcurrency([], 3, async () => 1)).toEqual([]);
  const r = await mapWithConcurrency([1, 2], 0, async x => x);
  expect(r.map(x => x.value)).toEqual([1, 2]);
});
