// "Amount in words" for the GST invoice, in Indian numbering (thousand / lakh / crore).
//   amountInWords(1234.5) -> "Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only"
// Pure; works on paise so 0.1 + 0.2 style float noise never leaks into the words.

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);

const below1000 = (n) => {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? below100(r) : ''].filter(Boolean).join(' ');
};

// Whole number (>= 0) in Indian grouping: 12,34,56,789 -> "Twelve Crore Thirty Four Lakh ..."
export function numberToIndianWords(value) {
  let n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${numberToIndianWords(crore)} Crore`); // crores can themselves exceed 99
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (n) parts.push(below1000(n));
  return parts.join(' ');
}

export function amountInWords(amount) {
  const v = Number(amount);
  if (!Number.isFinite(v) || v < 0) return '';
  const paiseTotal = Math.round(v * 100);
  const rupees = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;
  const rupeeWords = `Rupees ${numberToIndianWords(rupees)}`;
  return paise ? `${rupeeWords} and ${numberToIndianWords(paise)} Paise Only` : `${rupeeWords} Only`;
}
