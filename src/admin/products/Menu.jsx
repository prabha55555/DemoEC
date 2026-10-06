import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Button, Icon } from '../ui';

// A small action menu ("more" button on a table row, "Set status" in the bulk bar).
//
//   <Menu label="Actions for Cotton Kurta" items={[
//     { label: 'Edit', icon: 'edit', to: '/admin/products/1' },
//     { label: 'Duplicate', icon: 'copy', onClick: dup },
//     'divider',
//     { label: 'Delete', icon: 'trash', danger: true, onClick: remove, disabled: false },
//   ]} />
//   <Menu trigger={{ children: 'Set status', icon: 'check', iconRight: 'chevronDown', size: 'sm' }} label="Set status" items={…} />
//
// The panel is portalled to <body> and positioned from the button's rectangle: inside a scrolling table an ordinary
// absolute menu would be clipped by the table's own overflow. It closes on Escape, a click elsewhere, scrolling or a
// resize; arrow keys move between items and focus goes back to the button.
export default function Menu({ label, items, trigger, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const panel = useRef(null);
  const id = useId();

  const close = useCallback((refocus = false) => { setOpen(false); if (refocus) btn.current?.focus(); }, []);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = panel.current?.offsetWidth || 200;
    const h = panel.current?.offsetHeight || 160;
    const below = window.innerHeight - r.bottom;
    const top = below < h + 12 && r.top > h + 12 ? r.top - h - 6 : r.bottom + 6;
    const left = align === 'right' ? Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8) : Math.min(r.left, window.innerWidth - w - 8);
    setPos({ top, left });
  }, [open, align, items]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!panel.current?.contains(e.target) && !btn.current?.contains(e.target)) close(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(true); return; }
      const els = Array.from(panel.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || []);
      if (!els.length) return;
      const i = els.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); els[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); els[els.length - 1].focus(); }
      else if (e.key === 'Tab') close();
    };
    const onMove = () => close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    const t = setTimeout(() => panel.current?.querySelector('[role="menuitem"]:not([disabled])')?.focus(), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, close]);

  const props = trigger || { iconOnly: true, icon: 'more', variant: 'ghost', size: 'sm' };
  return (
    <>
      <Button
        ref={btn} {...props} aria-label={trigger ? undefined : label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
      />
      {open && createPortal(
        <div className="adm adm-portal">
          <div ref={panel} id={id} role="menu" aria-label={label} className="pm-menu" style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}>
            {items.map((it, i) => {
              if (it === 'divider') return <div key={`d${i}`} className="pm-menu-sep" role="separator" />;
              if (!it) return null;
              const cls = `pm-menu-item${it.danger ? ' is-danger' : ''}`;
              const inner = <>{it.icon && <Icon name={it.icon} size={16} />}<span>{it.label}</span></>;
              if (it.to && !it.disabled) return <Link key={it.label} role="menuitem" className={cls} to={it.to} onClick={() => close()}>{inner}</Link>;
              return (
                <button key={it.label} type="button" role="menuitem" className={cls} disabled={it.disabled} title={it.hint}
                  onClick={() => { close(); if (it.onClick) it.onClick(); }}>
                  {inner}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
