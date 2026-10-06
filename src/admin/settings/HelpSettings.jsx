import React from 'react';
import { useBrand } from '../../context/BrandContext';
import { Button, Card, EmptyState, Field, Textarea, TextInput } from '../ui';
import SettingsForm from './SettingsForm';
import useBrandForm from './useBrandForm';
import { guidesToSave, normaliseGuides } from './guides';

// Help Centre topics shown at /help: a list of { title, answer } (see guides.js for how older rows are read).
export default function HelpSettings() {
  const form = useBrandForm({
    initial: (b) => ({ guides: normaliseGuides(b.care_guides) }),
    validate: (v) => {
      const bad = v.guides.findIndex(g => (g.answer.trim() && !g.title.trim()) || (g.title.trim() && !g.answer.trim()));
      return { guides: bad >= 0 ? `Topic ${bad + 1} needs both a title and an answer (or remove it).` : '' };
    },
    toPayload: (v) => ({ care_guides: guidesToSave(v.guides) }),
    successMessage: 'Help topics saved.',
  });
  const { values, set, errors } = form;
  const guides = values.guides;
  const update = (i, k, v) => set('guides', guides.map((g, idx) => (idx === i ? { ...g, [k]: v } : g)));
  const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= guides.length) return; const a = [...guides]; [a[i], a[j]] = [a[j], a[i]]; set('guides', a); };
  const { brand } = useBrand();
  const usingDefaults = !(Array.isArray(brand.care_guides) && brand.care_guides.length);

  return (
    <SettingsForm form={form}>
      <Card title="Extra help topics" subtitle="Your Help page (/help) already answers common questions about orders, delivery, returns and payments from your store settings. Topics added here appear under “More help”."
        actions={<Button size="sm" icon="plus" onClick={() => set('guides', [...guides, { title: '', answer: '' }])}>Add topic</Button>}>
        <div className="adm-stack">
          {errors.guides && <div className="adm-note danger" role="alert">{errors.guides}</div>}
          {usingDefaults && <div className="adm-note">No extra topics are published yet. The topics below are suggestions to start from; edit them and save to publish them.</div>}
          {guides.length === 0 && <EmptyState compact icon="help" title="No extra topics" hint="The Help Centre shows only its built-in answers. Add a topic for anything specific to your store." />}
          {guides.map((g, i) => (
            <div className="adm-block" key={i}>
              <div className="adm-block-head">
                <span className="adm-block-title">Topic {i + 1}</span>
                <div className="adm-block-tools">
                  <Button size="sm" iconOnly icon="arrowUp" aria-label={`Move topic ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)} />
                  <Button size="sm" iconOnly icon="arrowDown" aria-label={`Move topic ${i + 1} down`} disabled={i === guides.length - 1} onClick={() => move(i, 1)} />
                  <Button size="sm" variant="danger" iconOnly icon="trash" aria-label={`Remove topic ${i + 1}`} onClick={() => set('guides', guides.filter((_, idx) => idx !== i))} />
                </div>
              </div>
              <Field label="Title"><TextInput value={g.title} onChange={v => update(i, 'title', v)} placeholder="e.g. How do returns work?" /></Field>
              <Field label="Answer"><Textarea rows={5} value={g.answer} onChange={v => update(i, 'answer', v)} placeholder="Write the answer shoppers will read. Use a new line for each point." /></Field>
            </div>
          ))}
        </div>
      </Card>
    </SettingsForm>
  );
}
