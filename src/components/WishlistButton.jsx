import React from 'react';
import { useWishlist } from '../context/WishlistContext';

// The heart. A component of its own so a wishlist change re-renders only the hearts, not every product card in the grid.
export default function WishlistButton({ productId, className = '', size = 18, showText = false }) {
  const { has, toggle } = useWishlist();
  const on = has(productId);
  const text = on ? 'Remove from wishlist' : 'Add to wishlist';
  return (
    <button
      type="button"
      className={`${className}${on ? ' is-on' : ''}`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(productId); }}
      aria-pressed={on}
      aria-label={text}
      title={text}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z" />
      </svg>
      {showText && <span>{on ? 'Wishlisted' : 'Wishlist'}</span>}
    </button>
  );
}
