import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './ui';
import useDismiss from './hooks/useDismiss';
import { ATTENTION_ITEMS, useAdminCounts } from './hooks/useAdminCounts';

const TONES = {
  warning: ['#FFF1D6', '#8A5000'], info: ['#E6EFFE', '#1D5FD1'], danger: ['#FDE9E7', '#C0352B'],
  primary: ['#E4F6F3', '#0F766E'], success: ['#E3F6EE', '#0F7B53'],
};

// The top-bar "needs attention" bell. Its badge and the list come from the SAME counts the dashboard tiles and
// sidebar badges use (useAdminCounts), so the three can never disagree. Each row links to the filtered list.
export default function AttentionBell() {
  const { counts, loading, attentionTotal, refresh } = useAdminCounts();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const btn = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  const focusButton = useCallback(() => btn.current?.focus(), []);
  useDismiss(wrap, open, close, focusButton);
  useEffect(() => { setOpen(false); }, [pathname]);

  const rows = ATTENTION_ITEMS.filter(it => counts[it.key] > 0);
  const label = attentionTotal > 0 ? `${attentionTotal} item${attentionTotal === 1 ? '' : 's'} need attention` : 'Nothing needs attention';

  return (
    <div style={{ position: 'relative' }} ref={wrap}>
      <button ref={btn} type="button" className="adm-icon-btn" aria-label={label} aria-haspopup="true" aria-expanded={open}
        title={label} onClick={() => { setOpen(o => !o); if (!open) refresh(); }}>
        <Icon name="bell" size={18} />
        {attentionTotal > 0 && <span className="adm-dot" aria-hidden="true">{attentionTotal > 99 ? '99+' : attentionTotal}</span>}
      </button>
      {open && (
        <div className="adm-pop bell right" role="region" aria-label="Needs attention">
          <div className="adm-pop-head">Needs attention</div>
          {loading ? <div className="adm-pop-empty" role="status">Checking…</div>
            : rows.length === 0 ? <div className="adm-pop-empty">All clear. Nothing is waiting for you.</div>
              : rows.map(it => (
                <button key={it.key} type="button" className="adm-pop-item" onClick={() => { setOpen(false); navigate(it.to); }}>
                  <span className="adm-pop-item-ico" style={{ background: TONES[it.tone][0], color: TONES[it.tone][1] }}><Icon name={it.icon} size={17} /></span>
                  <span className="adm-pop-item-main">
                    <span className="adm-pop-item-t">{it.label}</span>
                    <span className="adm-pop-item-d">{it.hint}</span>
                  </span>
                  <span className="adm-pop-item-n">{counts[it.key]}</span>
                </button>
              ))}
        </div>
      )}
    </div>
  );
}
