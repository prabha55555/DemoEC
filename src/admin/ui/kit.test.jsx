import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { Button, ConfirmDialog, DataTable, Field, FilterBar, Modal, MoneyInput, NumberInput, Pagination, SaveBar, StatusPill, TextInput, Thumb, Toggle } from './index';
import { pageItems } from './Pagination';
import useUrlFilters from '../hooks/useUrlFilters';

window.IS_REACT_ACT_ENVIRONMENT = true;

// The kit imports the upload helpers, which import the real Supabase client; nothing here touches the network.
jest.mock('../../supabase', () => ({ supabase: {} }));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

// jsdom does no layout, so nothing would count as visible to the focus trap; pretend everything is on screen.
beforeAll(() => { HTMLElement.prototype.getClientRects = function getClientRects() { return [{ width: 1, height: 1 }]; }; });

let root; let container;
async function mount(ui, route = '/') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>); });
  return container;
}
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  root = null; container = null;
  jest.useRealTimers();
  document.body.style.overflow = '';
});
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const typeInto = (el, value) => act(async () => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const wait = (ms = 5) => act(async () => { await new Promise(r => setTimeout(r, ms)); });

const cols = [{ key: 'name', header: 'Name' }, { key: 'qty', header: 'Quantity', align: 'right', render: r => <b>{r.qty}</b> }];

describe('DataTable', () => {
  test('shows skeleton rows while the first load is in flight', async () => {
    const c = await mount(<DataTable columns={cols} rows={[]} loading skeletonRows={3} />);
    expect(c.querySelectorAll('tr.is-skeleton')).toHaveLength(3);
    expect(c.querySelector('.adm-empty')).toBeNull();
  });
  test('shows the empty state with its message', async () => {
    const c = await mount(<DataTable columns={cols} rows={[]} empty={{ title: 'No orders match', hint: 'Clear a filter.' }} />);
    expect(c.textContent).toContain('No orders match');
    expect(c.querySelector('table')).toBeNull();
  });
  test('shows the error state and retries', async () => {
    const onRetry = jest.fn();
    const c = await mount(<DataTable columns={cols} rows={[]} error={{ message: 'boom' }} onRetry={onRetry} />);
    expect(c.textContent).toContain('boom');
    await click([...c.querySelectorAll('button')].find(b => /try again/i.test(b.textContent)));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  test('a permission failure is explained as access denied, not a database message', async () => {
    const c = await mount(<DataTable columns={cols} rows={[]} error={{ code: '42501', message: 'new row violates row-level security policy' }} />);
    expect(c.textContent).toMatch(/access denied/i);
    expect(c.textContent).not.toMatch(/row-level security/);
  });
  test('rows render with labelled cells for the mobile card layout, and the first cell links when rowHref is set', async () => {
    const c = await mount(<DataTable columns={cols} rows={[{ id: 'a1', name: 'Kurta', qty: 3 }]} rowHref={r => `/admin/x/${r.id}`} />);
    const a = c.querySelector('tbody td a.adm-dt-link');
    expect(a.getAttribute('href')).toBe('/admin/x/a1');
    expect(a.textContent).toBe('Kurta');
    expect([...c.querySelectorAll('tbody td')].map(td => td.getAttribute('data-label'))).toEqual(['Name', 'Quantity']);
  });
  test('keeps showing rows (dimmed) while a refetch is in flight', async () => {
    const c = await mount(<DataTable columns={cols} rows={[{ id: 1, name: 'A', qty: 1 }]} loading />);
    expect(c.querySelector('.adm-dt-scroll.is-loading')).not.toBeNull();
    expect(c.querySelectorAll('tbody tr')).toHaveLength(1);
  });
  test('selection: checkboxes report the new key list; the header box selects the whole page', async () => {
    const onSelectionChange = jest.fn();
    const rows = [{ id: 1, name: 'A', qty: 1 }, { id: 2, name: 'B', qty: 2 }];
    const c = await mount(<DataTable columns={cols} rows={rows} selectable selectedKeys={[1]} onSelectionChange={onSelectionChange} />);
    const boxes = c.querySelectorAll('input[type=checkbox]');
    expect(boxes).toHaveLength(3);
    await click(boxes[2]);
    expect(onSelectionChange).toHaveBeenLastCalledWith([1, 2]);
    await click(boxes[0]);
    expect(onSelectionChange).toHaveBeenLastCalledWith([1, 2]);
  });
  test('sortable headers call onSort and expose aria-sort', async () => {
    const onSort = jest.fn();
    const c = await mount(<DataTable columns={[{ key: 'name', header: 'Name', sortable: true }]} rows={[{ id: 1, name: 'A' }]} sort={{ key: 'name', dir: 'asc' }} onSort={onSort} />);
    expect(c.querySelector('th').getAttribute('aria-sort')).toBe('ascending');
    await click(c.querySelector('th button'));
    expect(onSort).toHaveBeenCalledWith('name');
  });
});

describe('Pagination', () => {
  test('pageItems keeps first, last and the neighbours of the current page', () => {
    expect(pageItems(1, 3)).toEqual([1, 2, 3]);
    expect(pageItems(5, 10)).toEqual([1, '…', 4, 5, 6, '…', 10]);
    expect(pageItems(1, 10)).toEqual([1, 2, '…', 10]);
  });
  test('renders nothing when everything fits on one page', async () => {
    const c = await mount(<Pagination page={1} pageSize={25} total={25} onPage={() => {}} />);
    expect(c.querySelector('nav')).toBeNull();
  });
  test('describes the window and pages forward', async () => {
    const onPage = jest.fn();
    const c = await mount(<Pagination page={2} pageSize={25} total={132} onPage={onPage} />);
    expect(c.textContent).toContain('Showing 26–50 of 132');
    await click(c.querySelector('[aria-label="Next page"]'));
    expect(onPage).toHaveBeenCalledWith(3);
    await click(c.querySelector('[aria-label="Page 1"]'));
    expect(onPage).toHaveBeenLastCalledWith(1);
    expect(c.querySelector('[aria-current="page"]').textContent).toBe('2');
  });
  test('the first page has no working Previous', async () => {
    const c = await mount(<Pagination page={1} pageSize={25} total={80} onPage={() => {}} />);
    expect(c.querySelector('[aria-label="Previous page"]').disabled).toBe(true);
  });
});

describe('FilterBar', () => {
  test('search is debounced, Enter sends it at once, and the box follows the parent when it clears the value', async () => {
    jest.useFakeTimers();
    const onSearch = jest.fn();
    const ui = (search) => <FilterBar search={search} onSearch={onSearch} debounceMs={300} />;
    const c = await mount(ui(''));
    const input = c.querySelector('input[type=search]');
    await typeInto(input, 'kur');
    expect(onSearch).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(299); });
    expect(onSearch).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(2); });
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith('kur');
    await typeInto(input, 'kurta');
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onSearch).toHaveBeenLastCalledWith('kurta');
    // The parent accepts the value (as useUrlFilters does), then clears it (the Clear button): the box must follow.
    await act(async () => { root.render(<MemoryRouter>{ui('kurta')}</MemoryRouter>); });
    expect(c.querySelector('input[type=search]').value).toBe('kurta');
    await act(async () => { root.render(<MemoryRouter>{ui('')}</MemoryRouter>); });
    expect(c.querySelector('input[type=search]').value).toBe('');
  });
  test('selects report their value, and Clear shows only when asked', async () => {
    const onChange = jest.fn(); const onClear = jest.fn();
    const c = await mount(<FilterBar selects={[{ key: 's', label: 'Status', value: '', onChange, allLabel: 'All', options: ['Placed', { value: 'x', label: 'Ex' }] }]} showClear onClear={onClear} />);
    const sel = c.querySelector('select');
    expect([...sel.options].map(o => o.textContent)).toEqual(['All', 'Placed', 'Ex']);
    await act(async () => { sel.value = 'x'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith('x');
    await click([...c.querySelectorAll('button')].find(b => /clear/i.test(b.textContent)));
    expect(onClear).toHaveBeenCalled();
  });
});

describe('forms', () => {
  test('Field wires label, hint and error to the control', async () => {
    const c = await mount(<Field label="Fee" hint="In rupees" error="Too high"><TextInput value="5" onChange={() => {}} /></Field>);
    const input = c.querySelector('input');
    const label = c.querySelector('label');
    expect(label.getAttribute('for')).toBe(input.id);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = input.getAttribute('aria-describedby').split(' ').map(id => c.querySelector(`[id="${id}"]`).textContent);
    expect(described).toEqual(['Too high', 'In rupees']);
    expect(c.querySelector('[role=alert]').textContent).toBe('Too high');
  });
  test('controls call onChange with the VALUE, not the event', async () => {
    const onChange = jest.fn();
    const c = await mount(<TextInput value="" onChange={onChange} />);
    await typeInto(c.querySelector('input'), 'abc');
    expect(onChange).toHaveBeenCalledWith('abc');
  });
  test('MoneyInput and NumberInput clean what is typed', async () => {
    const money = jest.fn(); const num = jest.fn();
    const c = await mount(<><MoneyInput value="" onChange={money} /><NumberInput value="" onChange={num} integer /></>);
    const [m, n] = c.querySelectorAll('input');
    await typeInto(m, '₹1,299.567');
    expect(money).toHaveBeenCalledWith('1299.56');
    await typeInto(n, '12.7'); // pasted into a whole-number box: the fraction is dropped
    expect(num).toHaveBeenCalledWith('12');
  });
  test('NumberInput clamps to min / max when the box loses focus', async () => {
    const onChange = jest.fn();
    const c = await mount(<NumberInput value="400" onChange={onChange} integer min={0} max={365} />);
    await act(async () => { c.querySelector('input').dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith('365');
  });
  test('Toggle is a labelled switch that reports a boolean', async () => {
    const onChange = jest.fn();
    const c = await mount(<Toggle checked={false} onChange={onChange} label="Accept COD" hint="Shown at checkout" />);
    const sw = c.querySelector('input[role=switch]');
    expect(c.querySelector(`label[for="${sw.id}"]`)).not.toBeNull();
    await click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
  test('SaveBar: Save is disabled until something changed, and says so', async () => {
    const onSave = jest.fn();
    const c = await mount(<SaveBar dirty={false} onSave={onSave} />);
    expect(c.textContent).toContain('All changes saved');
    expect([...c.querySelectorAll('button')].find(b => /save/i.test(b.textContent)).disabled).toBe(true);
    await act(async () => { root.render(<MemoryRouter><SaveBar dirty onSave={onSave} /></MemoryRouter>); });
    expect(c.textContent).toContain('unsaved changes');
    await click([...c.querySelectorAll('button')].find(b => /save/i.test(b.textContent)));
    expect(onSave).toHaveBeenCalled();
  });
});

describe('Button', () => {
  test('loading disables the button and marks it busy; a link renders as <a>', async () => {
    const c = await mount(<><Button loading>Save</Button><Button to="/admin/x">Go</Button><Button href="https://x.test" target="_blank">Out</Button></>);
    const [btn] = c.querySelectorAll('button');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    const links = c.querySelectorAll('a');
    expect(links[0].getAttribute('href')).toBe('/admin/x');
    expect(links[1].getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('StatusPill', () => {
  test('renders the label with its tone class', async () => {
    const c = await mount(<><StatusPill status="Shipped" kind="order" /><StatusPill status="cod_pending" kind="payment" /></>);
    const [a, b] = c.querySelectorAll('.adm-badge');
    expect(a.className).toContain('info');
    expect(a.textContent).toBe('Shipped');
    expect(b.className).toContain('warning');
    expect(b.textContent).toBe('Pay on delivery');
  });
});

describe('Modal / ConfirmDialog', () => {
  test('renders in a portal with dialog semantics, focuses inside, and Escape closes it', async () => {
    const onClose = jest.fn();
    await mount(<Modal open onClose={onClose} title="Edit thing"><input aria-label="inside" /></Modal>);
    await wait();
    const dlg = document.querySelector('[role=dialog]');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dlg.getAttribute('aria-labelledby')).textContent).toBe('Edit thing');
    expect(dlg.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => { dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onClose).toHaveBeenCalled();
  });
  test('Tab wraps inside the dialog (focus trap)', async () => {
    await mount(<Modal open onClose={() => {}} title="T" footer={<Button>Last</Button>}><input aria-label="first-field" /></Modal>);
    await wait();
    const dlg = document.querySelector('[role=dialog]');
    const last = [...dlg.querySelectorAll('button')].find(b => b.textContent === 'Last');
    last.focus();
    await act(async () => { dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); });
    expect(dlg.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(last);
  });
  test('closing restores page scroll', async () => {
    await mount(<Modal open onClose={() => {}} title="T">x</Modal>);
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => root.render(<MemoryRouter><Modal open={false} onClose={() => {}} title="T">x</Modal></MemoryRouter>));
    expect(document.body.style.overflow).toBe('');
    expect(document.querySelector('[role=dialog]')).toBeNull();
  });
  test('ConfirmDialog waits for an async confirm, shows busy, then closes', async () => {
    let finish; const onConfirm = jest.fn(() => new Promise(r => { finish = r; })); const onClose = jest.fn();
    await mount(<ConfirmDialog open onClose={onClose} onConfirm={onConfirm} title="Delete?" confirmLabel="Delete it" tone="danger" />);
    const dlg = document.querySelector('[role=alertdialog]');
    const confirmBtn = [...dlg.querySelectorAll('button')].find(b => b.textContent.includes('Delete it'));
    await click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirmBtn.disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { finish(true); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  test('ConfirmDialog stays open and shows the message when confirm returns false or throws', async () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn().mockRejectedValueOnce(new Error('Server said no')).mockResolvedValueOnce(false);
    await mount(<ConfirmDialog open onClose={onClose} onConfirm={onConfirm} title="Do it?" confirmLabel="Yes" />);
    const confirmBtn = () => [...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.includes('Yes'));
    await click(confirmBtn());
    expect(document.querySelector('[role=dialog]').textContent).toContain('Server said no');
    await click(confirmBtn());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Thumb', () => {
  test('falls back to the original file, then to a placeholder, never a broken image', async () => {
    const c = await mount(<Thumb src="https://x.supabase.co/storage/v1/object/public/images/a.jpg" width={96} />);
    let img = c.querySelector('img');
    expect(img.getAttribute('src')).toContain('/render/image/public/images/a.jpg');
    await act(async () => { img.dispatchEvent(new Event('error')); });
    img = c.querySelector('img');
    expect(img.getAttribute('src')).toBe('https://x.supabase.co/storage/v1/object/public/images/a.jpg');
    await act(async () => { img.dispatchEvent(new Event('error')); });
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('.adm-thumb-empty')).not.toBeNull();
  });
  test('no src -> placeholder', async () => {
    const c = await mount(<Thumb src={null} />);
    expect(c.querySelector('.adm-thumb-empty')).not.toBeNull();
  });
});

describe('useUrlFilters', () => {
  let latest; let loc;
  function Probe({ defaults }) {
    latest = useUrlFilters(defaults);
    loc = useLocation();
    return null;
  }
  const D = { q: '', status: '', page: 1 };

  test('reads values from the URL, with defaults and numeric pages', async () => {
    await mount(<Probe defaults={D} />, '/admin/orders?status=Placed,Packed&page=3');
    expect(latest.values).toEqual({ q: '', status: 'Placed,Packed', page: 3 });
    expect(latest.active).toBe(true);
  });
  test('set() writes only non-defaults and resets the page on a filter change', async () => {
    await mount(<Probe defaults={D} />, '/admin/orders?page=4');
    await act(async () => latest.set({ status: 'Shipped' }));
    expect(loc.search).toBe('?status=Shipped');
    await act(async () => latest.set({ page: 2 }));
    expect(loc.search).toBe('?status=Shipped&page=2');
    await act(async () => latest.set({ status: '' }));
    expect(loc.search).toBe('');
  });
  test('reset() clears every filter', async () => {
    await mount(<Probe defaults={D} />, '/admin/orders?q=kurta&status=Placed&page=2&other=keep');
    await act(async () => latest.reset());
    expect(loc.search).toBe('?other=keep');
    expect(latest.active).toBe(false);
  });
  test('a nonsense page falls back to the default', async () => {
    await mount(<Probe defaults={D} />, '/x?page=abc');
    expect(latest.values.page).toBe(1);
  });
});
