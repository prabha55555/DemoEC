import React from 'react';
import { Card, SaveBar, Skeleton } from '../ui';

// Shared frame for a settings tab driven by useBrandForm: a skeleton until the real settings row has arrived
// (so nothing can be edited -- or saved -- from placeholder values), then the fields and a sticky save bar.
//   <SettingsForm form={form}> …sections… </SettingsForm>
export default function SettingsForm({ form, children, maxWidth = 860 }) {
  if (!form.loaded) {
    return <div className="adm-stack" style={{ maxWidth }} role="status" aria-label="Loading settings"><Card><Skeleton height={20} width={180} /><div style={{ height: 14 }} /><Skeleton height={40} /><div style={{ height: 12 }} /><Skeleton height={40} /></Card></div>;
  }
  return (
    <div className="adm-stack" style={{ maxWidth }}>
      {children}
      <SaveBar dirty={form.dirty} saving={form.saving} onSave={form.save} onDiscard={form.reset} disabled={!form.loaded} />
    </div>
  );
}
