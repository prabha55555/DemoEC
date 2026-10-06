import { csvEscape, toCsv } from './csv';

describe('csvEscape', () => {
  test('plain values are untouched; null / undefined become empty', () => {
    expect(csvEscape('abc')).toBe('abc');
    expect(csvEscape(42)).toBe('42');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });
  test('quotes values containing a comma, quote or newline, doubling inner quotes', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape('a\rb')).toBe('"a\rb"');
  });
  test('neutralises spreadsheet formulas with a leading apostrophe', () => {
    expect(csvEscape('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvEscape('+91 98765')).toBe("'+91 98765");
    expect(csvEscape('-5')).toBe("'-5");
    expect(csvEscape('@cmd')).toBe("'@cmd");
    expect(csvEscape('=1,2')).toBe('"\'=1,2"');
  });
});

describe('toCsv', () => {
  const cols = [{ label: 'Order', get: r => r.id }, { label: 'Customer', get: r => r.name }, { label: 'Total', get: r => r.total }];
  test('header + CRLF rows, with a BOM for Excel', () => {
    const csv = toCsv(cols, [{ id: 'BL-1', name: 'Asha, K', total: 499 }, { id: 'BL-2', name: '=cmd', total: 0 }]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual(['Order,Customer,Total', 'BL-1,"Asha, K",499', "BL-2,'=cmd,0"]);
  });
  test('no rows -> header only', () => {
    expect(toCsv(cols, []).slice(1)).toBe('Order,Customer,Total');
  });
});
