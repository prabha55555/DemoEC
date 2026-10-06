import { pillFor } from './status';

describe('pillFor', () => {
  test('order statuses reuse statusTone, with Confirmed / Packed in the brand colour', () => {
    expect(pillFor('Placed', 'order')).toEqual({ tone: 'warning', label: 'Placed' });
    expect(pillFor('Confirmed', 'order')).toEqual({ tone: 'primary', label: 'Confirmed' });
    expect(pillFor('Packed', 'order')).toEqual({ tone: 'primary', label: 'Packed' });
    expect(pillFor('Shipped', 'order')).toEqual({ tone: 'info', label: 'Shipped' });
    expect(pillFor('Out for Delivery', 'order').tone).toBe('info');
    expect(pillFor('Delivered', 'order').tone).toBe('success');
    expect(pillFor('Cancelled', 'order').tone).toBe('danger');
    expect(pillFor('Returned', 'order').tone).toBe('danger');
  });
  test('legacy Paid / Pending read as Placed', () => {
    expect(pillFor('Paid', 'order')).toEqual({ tone: 'warning', label: 'Placed' });
    expect(pillFor('Pending')).toEqual({ tone: 'warning', label: 'Placed' });
  });
  test('payment statuses use the readable labels', () => {
    expect(pillFor('paid', 'payment')).toEqual({ tone: 'success', label: 'Paid' });
    expect(pillFor('cod_pending', 'payment')).toEqual({ tone: 'warning', label: 'Pay on delivery' });
    expect(pillFor('partially_refunded', 'payment')).toEqual({ tone: 'info', label: 'Partially refunded' });
    expect(pillFor('refunded', 'payment').tone).toBe('neutral');
  });
  test('return statuses', () => {
    expect(pillFor('Requested', 'return').tone).toBe('warning');
    expect(pillFor('Approved', 'return').tone).toBe('success');
    expect(pillFor('Rejected', 'return').tone).toBe('danger');
    expect(pillFor('Pickup Scheduled', 'return').tone).toBe('info');
    expect(pillFor('Refunded', 'return').tone).toBe('success');
  });
  test('product, review and stock statuses', () => {
    expect(pillFor('active', 'product')).toEqual({ tone: 'success', label: 'Active' });
    expect(pillFor('draft', 'product')).toEqual({ tone: 'warning', label: 'Draft' });
    expect(pillFor('archived', 'product').tone).toBe('neutral');
    expect(pillFor('pending', 'review').tone).toBe('warning');
    expect(pillFor('rejected', 'review').tone).toBe('danger');
    expect(pillFor('out', 'stock')).toEqual({ tone: 'danger', label: 'Out of stock' });
    expect(pillFor('low', 'stock').tone).toBe('warning');
  });
  test('auto-detects the kind', () => {
    expect(pillFor('Delivered').tone).toBe('success');
    expect(pillFor('Pickup Scheduled').tone).toBe('info');
    expect(pillFor('cod_pending').label).toBe('Pay on delivery');
    expect(pillFor('approved').tone).toBe('success');
  });
  test('unknown and empty values are neutral, never a crash', () => {
    expect(pillFor('something_new', 'generic')).toEqual({ tone: 'neutral', label: 'Something new' });
    expect(pillFor('', 'order')).toEqual({ tone: 'neutral', label: '—' });
    expect(pillFor(null)).toEqual({ tone: 'neutral', label: '—' });
  });
});
