import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import BlogManager from './BlogManager';
import BannersManager from './BannersManager';
import EmailTemplatesPage from '../messaging/EmailTemplatesPage';
import useRecord from '../hooks/useRecord';

window.IS_REACT_ACT_ENVIRONMENT = true;

// Regression: an edit screen seeded its form from the loaded row in an effect that ALSO depended on the form, so every
// keystroke re-ran it and put the row's old values straight back -- typing into an existing post did nothing.
jest.mock('../../supabase', () => ({ supabase: { from: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ count: 0 })) })) } }));
jest.mock('../../context/BrandContext', () => ({ useBrand: () => ({ brand: { brand_name: 'Test Store' }, updateBrand: jest.fn(), loading: false }) }));
jest.mock('../hooks/useRecord');
jest.mock('react-hot-toast', () => ({ __esModule: true, default: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));

let root; let container;
async function renderAt(path, pattern, element) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path={pattern} element={element} /></Routes></MemoryRouter>);
  });
  await act(async () => { await new Promise(r => setTimeout(r, 5)); });
  return container;
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  root = null;
});
const typeInto = (el, value) => act(async () => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const loaded = (record) => useRecord.mockReturnValue({ record, loading: false, error: null, notFound: false, reload: jest.fn() });

test('blog: edits to an existing post stay in the form and mark it unsaved', async () => {
  loaded({ id: 'p1', title: 'Old title', subtitle: '', category: 'Company News', author: 'A', story: 'x', images: [], published: true });
  const c = await renderAt('/admin/blog/p1', '/admin/blog/:id', <BlogManager />);
  const title = c.querySelector('input[placeholder^="e.g. 5 tips"]');
  expect(title.value).toBe('Old title');
  await typeInto(title, 'Old title v2');
  expect(c.querySelector('input[placeholder^="e.g. 5 tips"]').value).toBe('Old title v2');
  expect(c.querySelector('.adm-savebar').textContent).toContain('unsaved changes');
});

test('banners: edits to an existing slide stay in the form', async () => {
  loaded({ id: 's1', image_url: 'https://x.test/a.jpg', image_position: '50% 50%', mobile_image_url: '', headline: 'Sale', headline_size: 'medium', mobile_headline_size: '', subtext: '', subtext_size: 'medium', cta_label: 'Shop Now', cta_link: '/shop', cta_position: 'bottom-left', mobile_cta_position: '', show_cta: true, extra_ctas: [], display_order: 0, active: true });
  const c = await renderAt('/admin/banners/s1', '/admin/banners/:id', <BannersManager />);
  const headline = c.querySelector('textarea[maxlength="60"]');
  expect(headline.value).toBe('Sale');
  await typeInto(headline, 'Big sale');
  expect(c.querySelector('textarea[maxlength="60"]').value).toBe('Big sale');
  expect(c.querySelector('.adm-savebar').textContent).toContain('unsaved changes');
});

test('email templates: edits to an existing template stay in the form (null optional fields do not crash it)', async () => {
  loaded({ id: 't1', event_type: 'ORDER_SHIPPED', name: 'Shipped', subject: 'On its way', preview_text: null, sender_name: null, sender_email: null, body_blocks: [{ type: 'heading', text: 'Hi' }], enabled: true, is_system: true });
  const c = await renderAt('/admin/templates/email/t1', '/admin/templates/email/:id', <EmailTemplatesPage />);
  const subject = c.querySelector('input[placeholder^="e.g. Your order"]');
  expect(subject.value).toBe('On its way');
  await typeInto(subject, 'On its way now');
  expect(c.querySelector('input[placeholder^="e.g. Your order"]').value).toBe('On its way now');
  expect(c.querySelector('.adm-savebar').textContent).toContain('unsaved changes');
});

test('a post that does not exist says so instead of showing an empty form', async () => {
  useRecord.mockReturnValue({ record: null, loading: false, error: null, notFound: true, reload: jest.fn() });
  const c = await renderAt('/admin/blog/gone', '/admin/blog/:id', <BlogManager />);
  expect(c.textContent).toContain('Post not found');
  expect(c.querySelector('input[placeholder^="e.g. 5 tips"]')).toBeNull();
});
