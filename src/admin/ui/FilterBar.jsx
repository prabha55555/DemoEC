import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import Button from './Button';

// The strip above a list: search (debounced), dropdown filters, a date range, a Clear button.
//
//   <FilterBar
//     search={values.q} onSearch={q => set({ q })} searchPlaceholder="Search orders, customers…"
//     selects={[{ key: 'status', label: 'Status', value: values.status, onChange: v => set({ status: v }),
//                 options: ORDER_STATUSES, allLabel: 'All statuses' }]}
//     dateRange={{ from: values.from, to: values.to }} onDateRange={({ from, to }) => set({ from, to })}
//     onClear={reset} showClear={active}
//     actions={<Button icon="download" onClick={exportAll}>Export</Button>}
//   />
//
// onSearch fires `debounceMs` (300) after the last keystroke, or at once on Enter; the box follows `search`
// when the parent changes it (e.g. Clear). Selects: options are [{ value, label }] or plain strings; allLabel
// adds the "no filter" first option (value ''). The date inputs give 'YYYY-MM-DD' strings (use
// istRangeFilter from lib/format to turn them into a query). `children` = any extra controls.
export default function FilterBar({
  search, onSearch, searchPlaceholder = 'Search…', debounceMs = 300,
  selects = [], dateRange, onDateRange, onClear, showClear = false, actions, children, className = '',
}) {
  const [text, setText] = useState(search ?? '');
  const lastEmitted = useRef(search ?? '');

  // Follow the parent when it changes the value itself (Clear, a link with ?q=…).
  useEffect(() => {
    if ((search ?? '') !== lastEmitted.current) { lastEmitted.current = search ?? ''; setText(search ?? ''); }
  }, [search]);

  useEffect(() => {
    if (!onSearch || text === lastEmitted.current) return undefined;
    const t = setTimeout(() => { lastEmitted.current = text; onSearch(text); }, debounceMs);
    return () => clearTimeout(t);
  }, [text, onSearch, debounceMs]);

  const flush = () => { if (onSearch && text !== lastEmitted.current) { lastEmitted.current = text; onSearch(text); } };

  return (
    <div className={`adm-filterbar ${className}`.trim()} role="search">
      {onSearch && (
        <div className="adm-fb-search">
          <Icon name="search" size={16} />
          <input
            type="search" value={text} placeholder={searchPlaceholder} aria-label={searchPlaceholder}
            onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') flush(); }}
            onBlur={flush} autoComplete="off" spellCheck={false}
          />
        </div>
      )}
      {selects.map(s => (
        <label key={s.key} className="adm-fb-select">
          <span className="adm-sr">{s.label}</span>
          <select value={s.value ?? ''} onChange={e => s.onChange(e.target.value)} aria-label={s.label}>
            {s.allLabel !== undefined && <option value="">{s.allLabel}</option>}
            {(s.options || []).map(o => {
              const opt = typeof o === 'object' ? o : { value: o, label: o };
              return <option key={opt.value} value={opt.value}>{opt.label}</option>;
            })}
          </select>
          <Icon name="chevronDown" size={14} />
        </label>
      ))}
      {dateRange && onDateRange && (
        <div className="adm-fb-dates">
          <input type="date" value={dateRange.from || ''} max={dateRange.to || undefined} aria-label="From date"
            onChange={e => onDateRange({ from: e.target.value, to: dateRange.to || '' })} />
          <span aria-hidden="true">to</span>
          <input type="date" value={dateRange.to || ''} min={dateRange.from || undefined} aria-label="To date"
            onChange={e => onDateRange({ from: dateRange.from || '', to: e.target.value })} />
        </div>
      )}
      {children}
      {showClear && onClear && <Button variant="ghost" size="sm" icon="close" onClick={onClear}>Clear</Button>}
      {actions && <div className="adm-fb-actions">{actions}</div>}
    </div>
  );
}
