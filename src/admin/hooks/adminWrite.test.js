import toast from 'react-hot-toast';
import { adminWrite, AUTH_EXPIRED_EVENT, friendlyDbError, isPermissionError, NO_ROWS_DELETE_MESSAGE, NO_ROWS_MESSAGE } from './adminWrite';

jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

// A builder whose .select() resolves to `result`, like a Supabase write builder.
const builder = (result, method = 'PATCH') => ({ method, select: jest.fn(() => Promise.resolve(result)) });

beforeEach(() => { toast.success.mockClear(); toast.error.mockClear(); });

describe('adminWrite', () => {
  test('success: returns the rows and toasts the success text', async () => {
    const b = builder({ data: [{ id: 1 }], error: null });
    const r = await adminWrite(b, { success: 'Saved.' });
    expect(b.select).toHaveBeenCalledTimes(1); // .select() is what makes a silent no-op visible
    expect(r).toEqual({ ok: true, data: [{ id: 1 }], error: null });
    expect(toast.success).toHaveBeenCalledWith('Saved.');
    expect(toast.error).not.toHaveBeenCalled();
  });

  test('ZERO rows affected is a failure (RLS turns a forbidden update into a silent 200)', async () => {
    const r = await adminWrite(builder({ data: [], error: null }));
    expect(r.ok).toBe(false);
    expect(r.error.message).toBe(NO_ROWS_MESSAGE);
    expect(r.error.message).toMatch(/signed in as the store admin/);
    expect(r.error.code).toBe('NO_ROWS');
    expect(toast.error).toHaveBeenCalledWith(NO_ROWS_MESSAGE);
    expect(toast.success).not.toHaveBeenCalled();
  });

  test('a delete that removed nothing says so in its own words', async () => {
    const r = await adminWrite(builder({ data: [], error: null }, 'DELETE'));
    expect(r.error.message).toBe(NO_ROWS_DELETE_MESSAGE);
  });

  test('expectRows: false lets an empty result through', async () => {
    const r = await adminWrite(builder({ data: [], error: null }), { expectRows: false });
    expect(r.ok).toBe(true);
  });

  test('a database error becomes a friendly message', async () => {
    const r = await adminWrite(builder({ data: null, error: { code: '23505', message: 'duplicate key value' } }));
    expect(r.ok).toBe(false);
    expect(r.error.message).toMatch(/already exists/);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  test('custom wording per error code wins', async () => {
    const r = await adminWrite(builder({ data: null, error: { code: '23505', message: 'x' } }), { errors: { 23505: 'Another template already uses that.' } });
    expect(r.error.message).toBe('Another template already uses that.');
  });

  test('silent: no toasts either way', async () => {
    await adminWrite(builder({ data: [], error: null }), { silent: true });
    await adminWrite(builder({ data: [{ id: 1 }], error: null }), { silent: true, success: 'x' });
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  test('a thrown / rejected request is reported, not thrown', async () => {
    const b = { select: () => Promise.reject(new Error('Request timed out')) };
    const r = await adminWrite(b);
    expect(r.ok).toBe(false);
    expect(r.error.message).toMatch(/Timed out/);
  });

  test('an expired session raises the sign-in-again event', async () => {
    const seen = jest.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, seen);
    await adminWrite(builder({ data: null, error: { message: 'JWT expired' } }));
    window.removeEventListener(AUTH_EXPIRED_EVENT, seen);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe('friendlyDbError', () => {
  test('maps the common failures', () => {
    expect(friendlyDbError({ code: '42501', message: 'new row violates row-level security policy' })).toMatch(/permission/);
    expect(friendlyDbError({ code: '23503', message: 'fk' })).toMatch(/still used/);
    expect(friendlyDbError({ code: '42P01', message: 'relation does not exist' })).toMatch(/schema\.sql/);
    expect(friendlyDbError({ message: 'something odd' })).toBe('something odd');
    expect(friendlyDbError(null)).toBe('Something went wrong.');
  });
  test('isPermissionError', () => {
    expect(isPermissionError({ code: '42501' })).toBe(true);
    expect(isPermissionError({ message: 'permission denied for table x' })).toBe(true);
    expect(isPermissionError({ code: '23505' })).toBe(false);
    expect(isPermissionError(null)).toBe(false);
  });
});
