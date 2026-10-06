import React from 'react';

// A white bordered panel. <Card title="Recent orders" subtitle="Last 8" actions={<Button …/>}>…</Card>
//   pad={false} drops the body padding (for a DataTable or list that should reach the card edges)
//   footer: a node rendered in a tinted strip at the bottom (save buttons, "View all" links)
export function Card({ title, subtitle, actions, footer, pad = true, className = '', children, as: Tag = 'section', ...rest }) {
  return (
    <Tag className={`adm-card ${className}`.trim()} {...rest}>
      {(title || actions) && (
        <header className="adm-card-head">
          <div className="adm-card-head-text">
            {title && <h2 className="adm-card-title">{title}</h2>}
            {subtitle && <p className="adm-card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="adm-card-actions">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'adm-card-body' : undefined}>{children}</div>
      {footer && <footer className="adm-card-foot">{footer}</footer>}
    </Tag>
  );
}

// A titled form section: heading + explanatory text on the left (stacked on mobile), fields on the right.
// <Section title="Delivery fees" description="What shoppers pay when …">…fields…</Section>
export function Section({ title, description, actions, children, className = '', id }) {
  return (
    <section className={`adm-section ${className}`.trim()} id={id}>
      <div className="adm-section-intro">
        <h2 className="adm-section-title">{title}</h2>
        {description && <p className="adm-section-desc">{description}</p>}
        {actions && <div className="adm-section-actions">{actions}</div>}
      </div>
      <div className="adm-section-body">{children}</div>
    </section>
  );
}

export default Card;
