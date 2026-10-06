// A scannable Code 39 barcode for the packing slip, drawn as SVG rectangles (no font, no library). Code 39 can carry
// 0-9, A-Z and - . space $ / + % -- order numbers like "BL-20001" fit exactly, and any hand scanner reads it.
//
// Each character is 9 elements, alternating bar / space starting and ending with a bar; exactly 3 of the 9 are WIDE.
// Characters are separated by one narrow space, and the whole code is wrapped in "*" start / stop characters.
// 'n' = narrow, 'w' = wide.
const PATTERNS = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn',
  F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
  K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn',
  P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
  $: 'nwnwnwnnn', '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn',
};

// What can actually be encoded: upper-case, anything outside the Code 39 set (and "*") becomes "-".
export function code39Text(value) {
  return String(value ?? '').toUpperCase().split('').map(c => (c !== '*' && PATTERNS[c] ? c : '-')).join('');
}

// The bars of the barcode: [{ x, w }] in module units (a narrow element is 1, a wide one `ratio`), plus the total width.
export function code39Bars(value, { ratio = 3 } = {}) {
  const text = code39Text(value);
  const chars = ['*', ...text.split(''), '*'];
  const bars = [];
  let x = 0;
  chars.forEach((c, ci) => {
    PATTERNS[c].split('').forEach((el, i) => {
      const w = el === 'w' ? ratio : 1;
      if (i % 2 === 0) bars.push({ x, w });          // even positions are bars, odd are spaces
      x += w;
    });
    if (ci < chars.length - 1) x += 1;                // the narrow gap between characters
  });
  return { text, bars, width: x };
}

export const CODE39_PATTERNS = PATTERNS;
