import React from 'react';
import { Icon, Toggle } from '../ui';
import { EVENT_FOR_STATUS } from '../../utils/emailEvents';
import { planEventNotification, planNotification } from './orderLogic';
import useNotifyTemplates from './useNotifyTemplates';

// A plain-words list of the customer messages that WILL go out -- or a plain statement that nothing will, and why.
//   <NotifyPlan to="Shipped" order={order} notify={notify} onNotify={setNotify} />   status move, with the on/off switch
//   <NotifyPlan eventType="REFUND_PROCESSED" order={order} fixed />                    a refund: always sent, no switch
//   channels={['email']} for events the server only emails (return decisions)
export default function NotifyPlan({ to, eventType: eventProp, order, notify = true, onNotify, fixed = false, channels }) {
  const eventType = eventProp || EVENT_FOR_STATUS[to] || null;
  const { loading, templates } = useNotifyTemplates(eventType);
  const plan = eventProp ? planEventNotification({ eventType: eventProp, order, templates, channels }) : planNotification({ to, order, templates });
  const none = !eventType;

  return (
    <div className="ord-notify">
      {!fixed && (
        <Toggle
          checked={none ? false : notify} onChange={onNotify} disabled={none}
          label="Notify the customer by email / WhatsApp"
          hint={none ? undefined : 'Sent once, when you confirm. Switch off to change the status quietly.'}
        />
      )}
      {fixed && <div className="adm-label">Customer messages</div>}
      <ul className="ord-notify-list" aria-live="polite">
        {loading && <li className="adm-muted">Checking which messages are switched on…</li>}
        {!loading && templates.failed && <li className="is-skip"><Icon name="warning" size={15} /> <span>Could not check the message templates. The action still works.</span></li>}
        {!loading && !templates.failed && plan.lines.map(l => {
          const willSend = notify && l.state === 'send';
          const text = l.state === 'send' && !notify ? `${l.text.replace(/\.$/, '')} — not sent (notification switched off).` : l.text;
          return (
            <li key={l.channel} className={willSend ? 'is-send' : 'is-skip'}>
              <Icon name={willSend ? 'checkCircle' : l.state === 'none' ? 'info' : 'minus'} size={15} /> <span>{text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
