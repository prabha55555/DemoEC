import React from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { thumb } from '../utils/thumbnail';

// Rendered via toast.custom() from CartContext's addToCart -- a small
// "added to cart" notification with a way to jump straight to the cart,
// instead of a plain text toast.
export default function CartToast({ t, product, label }) {
  const navigate = useNavigate();
  const img = product.image;
  const option = product.variantLabel;

  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: '#fff', border: '1px solid var(--border)',
      borderRadius: 6,
      padding: 8, width: 'min(360px, calc(100vw - 32px))', boxSizing: 'border-box',
      boxShadow: 'var(--shadow-md)',
      opacity: t.visible ? 1 : 0,
      transform: t.visible ? 'translateX(0)' : 'translateX(24px)',
      transition: 'opacity .25s ease, transform .25s ease',
    }}>
      {img ? (
        <img src={thumb(img, 100)} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)', display: 'block', flexShrink: 0 }} />
      ) : (
        <div style={{ width: 44, height: 44, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-hover)', flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 11.5, color: 'var(--primary)', marginBottom: 1 }}>{label}</div>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {product.name}{option ? ` — ${option}` : ''}
        </div>
      </div>
      <button
        className="btn btn-gold btn-sm"
        onClick={() => { toast.dismiss(t.id); navigate('/cart'); }}
        style={{ flexShrink: 0, whiteSpace: 'nowrap', minHeight: 36, padding: '0 14px' }}
      >
        Go to Cart
      </button>
    </div>
  );
}
