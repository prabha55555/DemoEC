// CSV export, entirely client-side: builds the file from rows already in memory and triggers a browser
// download. Nothing here talks to a server.

// One CSV cell. Quotes values containing , " or a newline. A cell that STARTS with = + - @ tab or CR is
// prefixed with an apostrophe: Excel / Sheets would otherwise run it as a formula when the export is
// opened (a product or customer name starting with "=" must never execute on whoever opens the file).
export function csvEscape(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// columns: [{ label, get(row) }]  ->  the full CSV text (CRLF rows, UTF-8 BOM so Excel reads ₹ correctly).
export function toCsv(columns, rows) {
  const lines = [
    columns.map(c => csvEscape(c.label)).join(','),
    ...rows.map(row => columns.map(c => csvEscape(c.get(row))).join(',')),
  ];
  return `﻿${lines.join('\r\n')}`;
}

// Downloads `rows` as `filename`.
export function exportCsv(filename, columns, rows) {
  const blob = new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
