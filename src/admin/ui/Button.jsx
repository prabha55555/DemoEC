import React from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';

// <Button variant="primary" icon="plus" onClick={…}>Add product</Button>
//   variant: 'secondary' (default) | 'primary' | 'danger' | 'ghost' | 'link'      size: 'md' | 'sm'
//   loading: shows a spinner, disables the button and sets aria-busy (use while an async action runs)
//   to="/admin/x" renders a router <Link>, href="https://…" a plain <a> (target="_blank" gets rel=noopener)
//   icon / iconRight: an Icon name · block: full width · iconOnly: a square button (pass aria-label!)
const Button = React.forwardRef(function Button({
  variant = 'secondary', size = 'md', loading = false, icon, iconRight, to, href, block = false, iconOnly = false,
  className = '', children, disabled, type, ...rest
}, ref) {
  const cls = ['adm-btn', variant !== 'secondary' && variant, size === 'sm' && 'sm', block && 'block', iconOnly && 'icon', loading && 'is-loading', className]
    .filter(Boolean).join(' ');
  const content = (
    <>
      {loading ? <span className="adm-spinner" aria-hidden="true" /> : icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
      {children != null && children !== false && <span className="adm-btn-label">{children}</span>}
      {iconRight && !loading && <Icon name={iconRight} size={size === 'sm' ? 15 : 17} />}
    </>
  );
  if (to && !disabled) return <Link ref={ref} to={to} className={cls} {...rest}>{content}</Link>;
  if (href && !disabled) {
    const external = rest.target === '_blank';
    return <a ref={ref} href={href} className={cls} {...(external ? { rel: 'noopener noreferrer' } : {})} {...rest}>{content}</a>;
  }
  return (
    <button ref={ref} type={type || 'button'} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {content}
    </button>
  );
});

export default Button;
