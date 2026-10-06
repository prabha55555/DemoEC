import React, { useMemo, useState } from 'react';
import { formatDayShort, formatMoney, formatMoneyCompact, keyToDate } from '../lib/format';
import { niceMax } from './dashboardMath';

// Revenue per bucket (hour for "Today", day otherwise) as bars, with the order count in the hover tip. One series,
// one colour: the bar height is the story; the exact figures are in the tooltip and in the hidden data table that
// screen readers use instead of the picture.
//   buckets: [{ key, revenue, orders, hour? }]   daily keys are 'YYYY-MM-DD', hourly keys 'YYYY-MM-DDTHH'
const W = 600;
const H = 220;
const PAD = { l: 52, r: 8, t: 12, b: 26 };
const hourLabel = (h) => (h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`);

function labelFor(b) {
  if (b.hour !== undefined) return hourLabel(b.hour);
  return formatDayShort(keyToDate(b.key));
}

export default function RevenueChart({ buckets, color = '#0F766E' }) {
  const [hover, setHover] = useState(null);
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const max = useMemo(() => niceMax(Math.max(0, ...buckets.map(b => b.revenue))), [buckets]);
  const slot = plotW / buckets.length;
  const barW = Math.max(3, Math.min(34, slot * 0.66));
  const ticks = [0, 0.5, 1].map(f => ({ v: max * f, y: PAD.t + plotH - f * plotH }));
  const every = buckets.length <= 8 ? 1 : buckets.length <= 24 ? 6 : 5;
  const total = buckets.reduce((s, b) => s + b.revenue, 0);
  const orders = buckets.reduce((s, b) => s + b.orders, 0);
  const hb = hover !== null ? buckets[hover] : null;
  const hx = hover !== null ? PAD.l + slot * hover + slot / 2 : 0;

  return (
    <div className="adm-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Revenue chart: ${formatMoney(total)} from ${orders} order${orders === 1 ? '' : 's'}.`} onMouseLeave={() => setHover(null)}>
        {ticks.map(t => (
          <g key={t.v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={t.y} y2={t.y} stroke={t.v === 0 ? '#C3D9D4' : '#E7F1EF'} strokeWidth="1" />
            <text x={PAD.l - 8} y={t.y + 4} textAnchor="end" fontSize="11" fill="#52645F">{formatMoneyCompact(t.v)}</text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const h = b.revenue > 0 ? Math.max(2, (b.revenue / max) * plotH) : 0;
          const x = PAD.l + slot * i + (slot - barW) / 2;
          return (
            <g key={b.key} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
              <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={plotH} fill="transparent" />
              {h > 0 && <rect x={x} y={PAD.t + plotH - h} width={barW} height={h} rx="3" fill={color} opacity={hover === null || hover === i ? 1 : 0.45} />}
              {i % every === 0 && <text x={PAD.l + slot * i + slot / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#52645F">{labelFor(b)}</text>}
            </g>
          );
        })}
      </svg>
      {hb && (
        <div className="adm-chart-tip" style={{ left: `${(hx / W) * 100}%`, top: `${((PAD.t + plotH - Math.max(0, (hb.revenue / max) * plotH)) / H) * 100}%` }}>
          <b>{formatMoney(hb.revenue) || '₹0'}</b>
          <span>{hb.orders} order{hb.orders === 1 ? '' : 's'} · {labelFor(hb)}</span>
        </div>
      )}
      <table className="adm-sr">
        <caption>Revenue and orders</caption>
        <thead><tr><th scope="col">Period</th><th scope="col">Revenue</th><th scope="col">Orders</th></tr></thead>
        <tbody>{buckets.map(b => <tr key={b.key}><th scope="row">{labelFor(b)}</th><td>{formatMoney(b.revenue) || '₹0'}</td><td>{b.orders}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
