import React from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import { Skeleton } from './Skeleton';

// A KPI tile: icon, big figure, label, optional hint. Links somewhere when `to` is given.
//   <Stat label="Orders to process" value={12} icon="cart" tone="warning" to="/admin/orders?status=Placed,Confirmed,Packed"
//         hint="Placed, confirmed or packed" />
//   loading -> a skeleton figure; error -> "Unable to load" + Retry (never a misleading 0)
// tone: 'primary' | 'info' | 'success' | 'warning' | 'danger' | 'neutral'
export default function Stat({ label, value, hint, icon = 'chart', tone = 'primary', to, onClick, loading = false, error = false, onRetry }) {
  const body = (
    <>
      <span className={`adm-stat-ico ${tone}`}><Icon name={icon} size={20} /></span>
      <span className="adm-stat-main">
        {error ? (
          <span className="adm-stat-err">
            Unable to load
            {onRetry && <button type="button" className="adm-link-btn" onClick={e => { e.preventDefault(); e.stopPropagation(); onRetry(); }}>Retry</button>}
          </span>
        ) : loading ? <Skeleton width={72} height={26} radius={6} /> : <span className="adm-stat-val">{value}</span>}
        <span className="adm-stat-label">{label}</span>
        {hint && !error && <span className="adm-stat-hint">{hint}</span>}
      </span>
    </>
  );
  if (to && !error) return <Link to={to} className="adm-card adm-stat is-link">{body}</Link>;
  if (onClick && !error) return <button type="button" className="adm-card adm-stat is-link" onClick={onClick}>{body}</button>;
  return <div className="adm-card adm-stat">{body}</div>;
}
