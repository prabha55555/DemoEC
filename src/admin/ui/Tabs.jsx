import React from 'react';
import { NavLink } from 'react-router-dom';

// A row of tabs. Route-aware by default -- each tab is a real link, so the active tab survives a refresh and
// can be deep-linked:
//   <Tabs label="Store settings" items={[{ to: '/admin/settings/general', label: 'General' }, …]} />
// Or state-driven (no `to` on the items):
//   <Tabs label="View" items={[{ key: 'all', label: 'All', count: 12 }, …]} value={tab} onChange={setTab} />
// An item may carry `count` (a small number badge) and `end` (match the path exactly).
export default function Tabs({ items, value, onChange, label = 'Sections', className = '' }) {
  return (
    <nav className={`adm-tabs ${className}`.trim()} aria-label={label}>
      <ul className="adm-tabs-list">
        {items.map(it => {
          const inner = (
            <>
              {it.label}
              {it.count !== undefined && it.count !== null && <span className="adm-tab-count">{it.count}</span>}
            </>
          );
          return (
            <li key={it.to || it.key}>
              {it.to ? (
                <NavLink to={it.to} end={it.end} className={({ isActive }) => `adm-tab${isActive ? ' is-active' : ''}`}>{inner}</NavLink>
              ) : (
                <button type="button" className={`adm-tab${value === it.key ? ' is-active' : ''}`} aria-pressed={value === it.key}
                  onClick={() => onChange && onChange(it.key)}>{inner}</button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
