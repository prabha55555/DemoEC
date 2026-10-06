import React from 'react';
import Icon from './Icon';
import { pageCount, pageWindow } from '../hooks/serverList';

// Page numbers to show: always the first and last, the current page and its neighbours, with … between gaps.
export function pageItems(page, pages) {
  const out = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) out.push(i);
    else if (out[out.length - 1] !== '…') out.push('…');
  }
  return out;
}

// Server-side pagination controls: "Showing 26–50 of 132" + previous / numbered / next.
//   <Pagination page={list.page} pageSize={list.pageSize} total={list.count} onPage={list.setPage} />
// Optional page-size picker: pageSizes={[25, 50, 100]} onPageSize={setSize}.
// Renders nothing when everything fits on one page (and there is no page-size picker).
export default function Pagination({ page, pageSize, total, onPage, pageSizes, onPageSize, className = '' }) {
  const pages = pageCount(total, pageSize);
  const win = pageWindow(page, total, pageSize);
  if (total <= pageSize && !(pageSizes && onPageSize)) return null;
  return (
    <nav className={`adm-pager ${className}`.trim()} aria-label="Pagination">
      <div className="adm-pager-info" aria-live="polite">
        {win.total === 0 ? 'No results' : <>Showing <strong>{win.from}–{win.to}</strong> of <strong>{win.total.toLocaleString('en-IN')}</strong></>}
      </div>
      <div className="adm-pager-ctrl">
        {pageSizes && onPageSize && (
          <label className="adm-pager-size">
            <span className="adm-sr">Rows per page</span>
            <select value={pageSize} onChange={e => onPageSize(Number(e.target.value))} aria-label="Rows per page">
              {pageSizes.map(s => <option key={s} value={s}>{s} / page</option>)}
            </select>
          </label>
        )}
        {pages > 1 && (
          <>
            <button type="button" className="adm-pager-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><Icon name="chevronLeft" size={16} /></button>
            {pageItems(page, pages).map((n, i) => (n === '…'
              ? <span key={`e${i}`} className="adm-pager-gap" aria-hidden="true">…</span>
              : <button key={n} type="button" className={`adm-pager-btn${n === page ? ' is-active' : ''}`} onClick={() => onPage(n)} aria-label={`Page ${n}`} aria-current={n === page ? 'page' : undefined}>{n}</button>))}
            <button type="button" className="adm-pager-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><Icon name="chevronRight" size={16} /></button>
          </>
        )}
      </div>
    </nav>
  );
}
