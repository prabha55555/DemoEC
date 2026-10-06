import React from 'react';
import { normalizeStatus, statusTone, trackerSteps } from '../utils/orderStatus';
import { fmtDateShort, fmtDateTime } from '../utils/orderFormat';
import './orderUi.css';

// Coloured pill for an order / payment / return status ("Delivered", "Refunded", ...).
export function StatusBadge({ status, label }) {
  const s = normalizeStatus(status);
  const tone = statusTone(s);
  return <span className={`ob-badge is-${tone}`}>{label || s}</span>;
}

// Steps for the tracker. `trackerSteps` stops at where a cancelled order was cancelled; a Returned order
// shows the whole journey plus a final "Returned" step.
function stepsFor(order) {
  const steps = trackerSteps(order);
  if (normalizeStatus(order?.status) !== 'Returned') return steps;
  const timeline = Array.isArray(order?.timeline) ? order.timeline : [];
  const at = timeline.slice().reverse().find(t => t.status === 'Returned')?.at || null;
  return [...steps.map(s => ({ ...s, current: false })), { label: 'Returned', done: true, current: true, at, cancelled: true }];
}

const Tick = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>;
const Cross = () => <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>;

// Full tracker (order detail) or, with `compact`, a segmented bar + the current step in words (order cards).
export default function OrderStatusTracker({ order, compact = false }) {
  const steps = stepsFor(order);
  const current = steps.find(s => s.current) || steps[steps.length - 1];

  if (compact) {
    const cancelled = !!current?.cancelled;
    return (
      <div role="group" aria-label={`Order progress: ${current?.label || ''}`}>
        <div className="trkc-bar" aria-hidden="true">
          {steps.map(s => <span key={s.label} className={`trkc-seg${s.cancelled ? ' is-cancelled' : s.done ? ' is-done' : ''}`} />)}
        </div>
        <div className={`trkc-text${cancelled ? ' is-cancelled' : ''}`}>
          <strong style={{ fontWeight: 600 }}>{current?.label}</strong>
          {current?.at && <span> · {fmtDateShort(current.at)}</span>}
        </div>
      </div>
    );
  }

  return (
    <ol className="trk" aria-label="Order progress">
      {steps.map(s => (
        <li key={s.label} className={`trk-step${s.done ? ' is-done' : ''}${s.current ? ' is-current' : ''}${s.cancelled ? ' is-cancelled' : ''}`} aria-current={s.current ? 'step' : undefined}>
          <span className="trk-dot">{s.cancelled ? <Cross /> : s.done ? <Tick /> : null}</span>
          <span className="trk-label">{s.label}</span>
          {s.at && <span className="trk-at">{fmtDateTime(s.at)}</span>}
        </li>
      ))}
    </ol>
  );
}
