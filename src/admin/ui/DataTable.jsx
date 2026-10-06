import React, { useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Skeleton } from './Skeleton';
import { EmptyState, ErrorState } from './EmptyState';
import Icon from './Icon';

// The one list/table component. Pairs with useServerList + Pagination:
//
//   const list = useServerList({ table: 'orders', … });
//   <DataTable
//     caption="Orders"
//     columns={[
//       { key: 'order_id', header: 'Order', render: o => <strong>{o.order_id}</strong> },       // first column = the row's title on mobile
//       { key: 'status', header: 'Status', render: o => <StatusPill status={o.status} kind="order" /> },
//       { key: 'total', header: 'Total', align: 'right', render: o => <Money value={o.total} /> },
//     ]}
//     rows={list.rows} rowKey="id" loading={list.loading} error={list.error} onRetry={list.reload}
//     rowHref={o => `/admin/orders/${o.order_id}`}
//     empty={{ icon: 'cart', title: 'No orders match', hint: 'Try clearing a filter.' }}
//     footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.count} onPage={list.setPage} />}
//   />
//
// Column: { key, header, render?(row, i), width, align: 'left'|'right'|'center', sortable, hideOnMobile, className, mobileLabel }
//   - without render the cell shows row[key]; header may be '' for an actions column (give it mobileLabel '' too)
//   - sortable columns show a sort arrow; pass sort={{ key, dir: 'asc'|'desc' }} and onSort(key) to sort on the server
// Row interaction: rowHref(row) makes the first cell a real link (the whole row is clickable too);
//   onRowClick(row) makes rows focusable buttons. Clicks on buttons / links / inputs inside a row never trigger it.
// Selection: selectable + selectedKeys (array of row keys) + onSelectionChange(nextKeys) adds a checkbox column.
// On screens under 720px the table becomes a stack of cards (each cell labelled with its column header).
export default function DataTable({
  columns, rows = [], rowKey = 'id', loading = false, error = null, onRetry, empty, footer, caption,
  rowHref, onRowClick, sort, onSort, selectable = false, selectedKeys = [], onSelectionChange,
  skeletonRows = 6, stickyHeader = true, dense = false, className = '', rowClassName,
}) {
  const navigate = useNavigate();
  const keyOf = useCallback((row, i) => (typeof rowKey === 'function' ? rowKey(row, i) : row[rowKey] ?? i), [rowKey]);
  const interactive = !!(rowHref || onRowClick);
  const showSkeleton = loading && rows.length === 0 && !error;
  const isEmpty = !loading && !error && rows.length === 0;
  const allKeys = rows.map(keyOf);
  const allSelected = selectable && rows.length > 0 && allKeys.every(k => selectedKeys.includes(k));

  function toggleAll() {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? selectedKeys.filter(k => !allKeys.includes(k)) : Array.from(new Set([...selectedKeys, ...allKeys])));
  }
  function toggleOne(k) {
    if (!onSelectionChange) return;
    onSelectionChange(selectedKeys.includes(k) ? selectedKeys.filter(x => x !== k) : [...selectedKeys, k]);
  }
  function activate(row) {
    if (rowHref) navigate(rowHref(row));
    else if (onRowClick) onRowClick(row);
  }
  function onRowMouseUp(e, row) {
    if (e.button !== 0 || e.target.closest('a, button, input, select, textarea, label, [role="button"]')) return;
    if (window.getSelection && String(window.getSelection())) return; // the user was selecting text
    activate(row);
  }

  return (
    <div className={`adm-dt-card ${className}`.trim()}>
      {error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : isEmpty ? (
        <EmptyState {...(empty || { title: 'Nothing to show' })} />
      ) : (
        <div className={`adm-dt-scroll${stickyHeader ? ' sticky' : ''}${loading && rows.length ? ' is-loading' : ''}`} aria-busy={loading || undefined}>
          <table className={`adm-dt${dense ? ' dense' : ''}${interactive ? ' interactive' : ''}`} role="table">
            {caption && <caption className="adm-sr">{caption}</caption>}
            <thead role="rowgroup">
              <tr role="row">
                {selectable && (
                  <th role="columnheader" className="adm-dt-check" scope="col">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all rows on this page" />
                  </th>
                )}
                {columns.map(c => {
                  const sorted = sort && sort.key === c.key;
                  return (
                    <th
                      key={c.key} role="columnheader" scope="col" style={{ width: c.width, textAlign: c.align }}
                      className={`${c.hideOnMobile ? 'hide-sm' : ''}${c.className ? ` ${c.className}` : ''}`.trim() || undefined}
                      aria-sort={sorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      {c.sortable && onSort ? (
                        <button type="button" className="adm-dt-sort" onClick={() => onSort(c.key)}>
                          {c.header}
                          <Icon name={sorted ? (sort.dir === 'asc' ? 'arrowUp' : 'arrowDown') : 'chevronDown'} size={13} style={{ opacity: sorted ? 1 : .35 }} />
                        </button>
                      ) : c.header}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {showSkeleton
                ? Array.from({ length: skeletonRows }).map((_, i) => (
                  <tr key={`s${i}`} role="row" className="is-skeleton">
                    {selectable && <td role="cell" className="adm-dt-check"><Skeleton width={16} height={16} radius={4} /></td>}
                    {columns.map((c, j) => (
                      <td key={c.key} role="cell" className={c.hideOnMobile ? 'hide-sm' : undefined} data-label={c.mobileLabel ?? c.header}>
                        <Skeleton height={13} width={`${j === 0 ? 70 : 45 + ((i + j) % 3) * 15}%`} />
                      </td>
                    ))}
                  </tr>
                ))
                : rows.map((row, i) => {
                  const k = keyOf(row, i);
                  const picked = selectable && selectedKeys.includes(k);
                  return (
                    <tr
                      key={k} role="row"
                      className={`${picked ? 'is-selected ' : ''}${rowClassName ? (rowClassName(row) || '') : ''}`.trim() || undefined}
                      onMouseUp={interactive ? (e => onRowMouseUp(e, row)) : undefined}
                      tabIndex={onRowClick && !rowHref ? 0 : undefined}
                      onKeyDown={onRowClick && !rowHref ? (e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onRowClick(row); } }) : undefined}
                    >
                      {selectable && (
                        <td role="cell" className="adm-dt-check">
                          <input type="checkbox" checked={picked} onChange={() => toggleOne(k)} aria-label="Select this row" />
                        </td>
                      )}
                      {columns.map((c, j) => {
                        const content = c.render ? c.render(row, i) : row[c.key];
                        return (
                          <td
                            key={c.key} role="cell" style={{ textAlign: c.align }} data-label={c.mobileLabel ?? c.header}
                            className={`${c.hideOnMobile ? 'hide-sm' : ''}${j === 0 ? ' adm-dt-first' : ''}${c.className ? ` ${c.className}` : ''}`.trim() || undefined}
                          >
                            {j === 0 && rowHref ? <Link to={rowHref(row)} className="adm-dt-link">{content}</Link> : content}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
      {footer && !error && !isEmpty && <div className="adm-dt-foot">{footer}</div>}
    </div>
  );
}
