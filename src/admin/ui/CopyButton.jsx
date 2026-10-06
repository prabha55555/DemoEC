import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import Icon from './Icon';

// Copies `text` to the clipboard and flips to "Copied" for a moment. Works on http (older-browser fallback) too.
//   <CopyButton text={order.order_id} />                       small icon button
//   <CopyButton text="{{order_number}}" label="Copy" />        with a text label
export default function CopyButton({ text, label, copiedLabel = 'Copied', className = '', toastMessage }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (!ok) throw new Error('copy failed');
      }
      setCopied(true);
      if (toastMessage) toast.success(toastMessage);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Could not copy — select the text and copy it manually.');
    }
  }

  return (
    <button type="button" className={`adm-copy${label ? ' with-label' : ''} ${className}`.trim()} onClick={copy}
      aria-label={label ? undefined : `Copy ${text}`} title={copied ? copiedLabel : 'Copy to clipboard'}>
      <Icon name={copied ? 'check' : 'copy'} size={14} />
      {label && <span>{copied ? copiedLabel : label}</span>}
    </button>
  );
}
