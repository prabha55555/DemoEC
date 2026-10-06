import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button, Icon } from '../ui';
import useDismiss from '../hooks/useDismiss';

// A small dropdown menu (the kit has buttons and dialogs but no menu). One trigger button; the items are real
// buttons with role="menuitem". Arrow keys move, Enter / Space picks, Escape and a click outside close it and
// hand focus back to the trigger.
//
//   <ActionMenu label="Move to…" icon="truck" items={[
//     { key: 'packed', label: 'Packed', hint: 'Ready to hand over', onSelect: () => … },
//     { separator: true },
//     { key: 'cancel', label: 'Cancel order', tone: 'danger', icon: 'close', onSelect: … },
//   ]} />
export default function ActionMenu({ label, icon, items, align = 'right', variant, size, iconOnly = false, disabled = false, 'aria-label': ariaLabel }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const trigger = useRef(null);
  const menu = useRef(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(wrap, open, close, () => trigger.current && trigger.current.focus());

  // Focus the first enabled item when the menu opens.
  useEffect(() => {
    if (!open) return;
    const first = menu.current && menu.current.querySelector('[role="menuitem"]:not([disabled])');
    if (first) first.focus();
  }, [open]);

  function onKeyDown(e) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const els = Array.from(menu.current.querySelectorAll('[role="menuitem"]:not([disabled])'));
    if (!els.length) return;
    e.preventDefault();
    const i = els.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1 : e.key === 'ArrowDown' ? (i + 1) % els.length : (i - 1 + els.length) % els.length;
    els[next].focus();
  }

  function pick(item) {
    setOpen(false);
    if (trigger.current) trigger.current.focus();
    if (item.onSelect) item.onSelect();
  }

  return (
    <div className="ord-menu" ref={wrap}>
      <Button ref={trigger} variant={variant} size={size} icon={icon} iconRight={iconOnly ? undefined : 'chevronDown'} iconOnly={iconOnly} disabled={disabled}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={ariaLabel}
        onClick={() => setOpen(o => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}>
        {iconOnly ? null : label}
      </Button>
      {open && (
        <div className={`adm-pop ord-menu-pop${align === 'right' ? ' right' : ''}`} id={id} role="menu" ref={menu} onKeyDown={onKeyDown}>
          {items.map((it, i) => (it.separator
            ? <div key={`sep${i}`} className="ord-menu-sep" role="separator" />
            : (
              <button key={it.key} type="button" role="menuitem" className={`adm-pop-item ord-menu-item${it.tone === 'danger' ? ' is-danger' : ''}`} disabled={it.disabled} onClick={() => pick(it)}>
                {it.icon && <Icon name={it.icon} size={17} />}
                <span className="adm-pop-item-main">
                  <span className="adm-pop-item-t">{it.label}</span>
                  {it.hint && <span className="adm-pop-item-d">{it.hint}</span>}
                </span>
              </button>
            )))}
        </div>
      )}
    </div>
  );
}
