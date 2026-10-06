import { CARE_GUIDES_DEFAULT } from '../../data/careGuides';

// Help Centre topics are stored as a list of { title, answer }. Older rows used { material, icon, steps, tagline, note }:
// those are read as title = material and answer = the steps one per line (or the description / tagline), plus the note,
// and are written back in the new shape the next time the admin saves. Nothing saved yet -> the built-in defaults.
export function normaliseGuides(raw) {
  const list = Array.isArray(raw) && raw.length ? raw : CARE_GUIDES_DEFAULT;
  return list.map((g) => {
    if (typeof g.title === 'string' || typeof g.answer === 'string') return { title: g.title || '', answer: g.answer || '' };
    const body = Array.isArray(g.steps) && g.steps.length ? g.steps.join('\n') : (g.description || g.tagline || '');
    return { title: g.material || '', answer: [body, g.note].filter(Boolean).join('\n\n') };
  });
}

// The topics to save: trimmed, with half-filled / empty ones dropped.
export function guidesToSave(guides) {
  return guides.map(g => ({ title: g.title.trim(), answer: g.answer.trim() })).filter(g => g.title && g.answer);
}
