import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from './Icon';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { crumbsFor } from '../navConfig';

// The top of every admin screen: breadcrumb trail, title, subtitle and action buttons. Also sets the tab title.
//   <PageHeader title="Orders" subtitle="Track payments and delivery"
//               actions={<Button variant="primary" icon="plus" to="/admin/orders/new">New order</Button>} />
// The trail is worked out from the URL (Dashboard › Sales › Orders › Order). Override it with:
//   crumbLabel="BL-20001"            replaces the last crumb (a record's own name instead of "Order")
//   breadcrumb={[{ label, to? }, …]} a fully custom trail            back={{ to, label }}  a "← Back to …" link instead
export default function PageHeader({ title, subtitle, actions, breadcrumb, crumbLabel, back }) {
  const { pathname } = useLocation();
  const trail = breadcrumb || (back ? [] : crumbsFor(pathname, crumbLabel));
  useDocumentTitle(typeof title === 'string' ? title : crumbLabel);
  return (
    <header className="adm-page-head">
      {back && (
        <Link to={back.to} className="adm-back"><Icon name="arrowLeft" size={15} /> {back.label || 'Back'}</Link>
      )}
      {trail.length > 0 && (
        <nav className="adm-crumbs" aria-label="Breadcrumb">
          <ol>
            {trail.map((c, i) => (
              <li key={`${c.label}-${i}`}>
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current={i === trail.length - 1 ? 'page' : undefined}>{c.label}</span>}
                {i < trail.length - 1 && <Icon name="chevronRight" size={12} />}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="adm-page-head-row">
        <div className="adm-page-head-text">
          <h1 className="adm-page-title">{title}</h1>
          {subtitle && <p className="adm-page-sub">{subtitle}</p>}
        </div>
        {actions && <div className="adm-page-actions">{actions}</div>}
      </div>
    </header>
  );
}
