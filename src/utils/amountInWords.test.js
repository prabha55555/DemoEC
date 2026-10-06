import { amountInWords, numberToIndianWords } from './amountInWords';

describe('numberToIndianWords', () => {
  test('small numbers and teens', () => {
    expect(numberToIndianWords(0)).toBe('Zero');
    expect(numberToIndianWords(7)).toBe('Seven');
    expect(numberToIndianWords(19)).toBe('Nineteen');
    expect(numberToIndianWords(40)).toBe('Forty');
    expect(numberToIndianWords(99)).toBe('Ninety Nine');
  });
  test('hundreds and thousands', () => {
    expect(numberToIndianWords(100)).toBe('One Hundred');
    expect(numberToIndianWords(305)).toBe('Three Hundred Five');
    expect(numberToIndianWords(1000)).toBe('One Thousand');
    expect(numberToIndianWords(12345)).toBe('Twelve Thousand Three Hundred Forty Five');
  });
  test('lakh and crore use Indian grouping', () => {
    expect(numberToIndianWords(100000)).toBe('One Lakh');
    expect(numberToIndianWords(123456)).toBe('One Lakh Twenty Three Thousand Four Hundred Fifty Six');
    expect(numberToIndianWords(10000000)).toBe('One Crore');
    expect(numberToIndianWords(123456789)).toBe('Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine');
    expect(numberToIndianWords(1500000000)).toBe('One Hundred Fifty Crore');
  });
});

describe('amountInWords', () => {
  test('whole rupees', () => {
    expect(amountInWords(1299)).toBe('Rupees One Thousand Two Hundred Ninety Nine Only');
    expect(amountInWords(0)).toBe('Rupees Zero Only');
  });
  test('paise are spelled out', () => {
    expect(amountInWords(1234.5)).toBe('Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only');
    expect(amountInWords(0.05)).toBe('Rupees Zero and Five Paise Only');
  });
  test('float noise does not leak into the words', () => {
    expect(amountInWords(0.1 + 0.2)).toBe('Rupees Zero and Thirty Paise Only');
    expect(amountInWords(299.99999999)).toBe('Rupees Three Hundred Only');
  });
  test('invalid input gives an empty string', () => {
    expect(amountInWords('abc')).toBe('');
    expect(amountInWords(-5)).toBe('');
    expect(amountInWords(null)).toBe('Rupees Zero Only');
  });
});
