import React from 'react';
import Button from './Button';
import Icon from './Icon';

// The sticky strip at the bottom of an edit form: "You have unsaved changes" + Discard / Save.
//   <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={reset} disabled={!loaded} />
// Save is disabled while nothing changed or while saving; `disabled` additionally blocks it (e.g. settings not loaded yet).
// Pair with useUnsavedChanges(dirty) so leaving the page asks first.
export default function SaveBar({ dirty, saving = false, onSave, onDiscard, disabled = false, saveLabel = 'Save changes', message }) {
  return (
    <div className={`adm-savebar${dirty ? ' is-dirty' : ''}`} role="region" aria-label="Save changes">
      <div className="adm-savebar-msg" aria-live="polite">
        {dirty ? <><Icon name="warning" size={16} /> {message || 'You have unsaved changes.'}</> : <span className="adm-muted">All changes saved.</span>}
      </div>
      <div className="adm-savebar-btns">
        {onDiscard && <Button onClick={onDiscard} disabled={!dirty || saving}>Discard</Button>}
        <Button variant="primary" loading={saving} disabled={!dirty || disabled} onClick={onSave}>{saveLabel}</Button>
      </div>
    </div>
  );
}
