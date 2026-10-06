import React from 'react';
import { formatMoney, formatDate, formatDateTime, relativeTime } from '../lib/format';

// <Money value={order.total} />  ->  ₹1,299 / ₹1,299.50   (en-IN grouping; renders "—" for a missing value)
export function Money({ value, className = '', muted = false, strike = false }) {
  const text = value === null || value === undefined || value === '' ? '' : formatMoney(value);
  if (!text) return <span className="adm-muted">—</span>;
  return <span className={`adm-money${strike ? ' strike' : ''}${muted ? ' adm-muted' : ''} ${className}`.trim()}>{text}</span>;
}

// <DateTime value={order.created_at} />  ->  06 Oct 2026, 3:42 pm  (always Indian Standard Time)
//   dateOnly -> "06 Oct 2026" · relative -> "5 min ago" with the full date as the hover title
export function DateTime({ value, dateOnly = false, relative = false, className = '' }) {
  if (!value) return <span className="adm-muted">—</span>;
  const full = formatDateTime(value);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return <span className="adm-muted">—</span>;
  const text = relative ? relativeTime(value) : dateOnly ? formatDate(value) : full;
  return <time className={className || undefined} dateTime={d.toISOString()} title={relative || dateOnly ? `${full} IST` : 'Indian Standard Time'}>{text}</time>;
}
