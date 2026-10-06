import React from 'react';
import Icon from './Icon';
import Button from './Button';
import { isPermissionError } from '../hooks/adminWrite';

// "Nothing here yet" -- always say what the list is for and offer the next step.
//   <EmptyState icon="box" title="No products yet" hint="Add your first product to start selling."
//               action={<Button variant="primary" to="/admin/products/new">Add product</Button>} />
export function EmptyState({ icon = 'box', title, hint, action, compact = false }) {
  return (
    <div className={`adm-empty${compact ? ' compact' : ''}`} role="status">
      <span className="adm-empty-ico"><Icon name={icon} size={compact ? 24 : 30} /></span>
      <div className="adm-empty-title">{title}</div>
      {hint && <div className="adm-empty-hint">{hint}</div>}
      {action && <div className="adm-empty-action">{action}</div>}
    </div>
  );
}

// A failed load, with a way out. `error` is whatever the query returned: a permission failure (RLS) is
// explained as an access problem instead of echoing a database message.
//   if (error) return <ErrorState error={error} onRetry={reload} />
export function ErrorState({ title = "Couldn't load this", error, message, onRetry, compact = false }) {
  const denied = isPermissionError(error);
  const text = message
    || (denied ? "You don't have access to this data. Sign in again as the store admin." : (error?.message || 'Something went wrong. Please try again.'));
  return (
    <div className={`adm-empty is-error${compact ? ' compact' : ''}`} role="alert">
      <span className="adm-empty-ico"><Icon name={denied ? 'lock' : 'warning'} size={compact ? 24 : 30} /></span>
      <div className="adm-empty-title">{denied ? 'Access denied' : title}</div>
      <div className="adm-empty-hint">{text}</div>
      {onRetry && <div className="adm-empty-action"><Button size="sm" icon="refresh" onClick={onRetry}>Try again</Button></div>}
    </div>
  );
}

export default EmptyState;
