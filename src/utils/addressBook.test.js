import { addressKey, defaultAddress, normalizeAddresses, orderAddressOf, removeAddress, setDefaultAddress, sortAddresses, upsertAddress } from './addressBook';

const A = { name: 'Asha', phone: '9876543210', line1: '12 Main Road', line2: '', city: 'Pune', state: 'Maharashtra', pincode: '411001' };
const B = { name: 'Ravi', phone: '9123456780', line1: '4 Lake View', line2: '', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' };

describe('normalizeAddresses', () => {
  test('adds ids to old entries and makes the first one the default', () => {
    const out = normalizeAddresses([A, B]);
    expect(out).toHaveLength(2);
    expect(out.every(a => a.id)).toBe(true);
    expect(out.map(a => a.isDefault)).toEqual([true, false]);
  });
  test('keeps existing ids and only one default', () => {
    const out = normalizeAddresses([{ ...A, id: 'a', isDefault: true }, { ...B, id: 'b', isDefault: true }]);
    expect(out.map(a => a.id)).toEqual(['a', 'b']);
    expect(out.filter(a => a.isDefault)).toHaveLength(1);
  });
  test('drops junk and tolerates non-arrays', () => {
    expect(normalizeAddresses(null)).toEqual([]);
    expect(normalizeAddresses([null, { name: 'x' }, A])).toHaveLength(1);
  });
});

describe('upsertAddress', () => {
  test('the first address saved becomes the default', () => {
    const { addresses, id } = upsertAddress([], A);
    expect(addresses).toHaveLength(1);
    expect(addresses[0]).toMatchObject({ id, isDefault: true, line1: '12 Main Road' });
  });
  test('the same line1 + pincode is updated, not duplicated', () => {
    const first = upsertAddress([], A).addresses;
    const { addresses } = upsertAddress(first, { ...A, line1: '  12  main road ', name: 'Asha R' });
    expect(addresses).toHaveLength(1);
    expect(addresses[0].name).toBe('Asha R');
  });
  test('a different pincode is a different address', () => {
    const first = upsertAddress([], A).addresses;
    expect(upsertAddress(first, { ...A, pincode: '411002' }).addresses).toHaveLength(2);
  });
  test('editing by id changes that entry in place and keeps the default flag', () => {
    const list = upsertAddress(upsertAddress([], A).addresses, B).addresses;
    const bId = list.find(a => a.line1 === B.line1).id;
    const { addresses } = upsertAddress(list, { ...B, city: 'Madurai' }, { id: bId });
    expect(addresses).toHaveLength(2);
    expect(addresses.find(a => a.id === bId).city).toBe('Madurai');
    expect(addresses.find(a => a.isDefault).line1).toBe(A.line1);
  });
  test('makeDefault moves the default', () => {
    const list = upsertAddress([], A).addresses;
    const { addresses, id } = upsertAddress(list, B, { makeDefault: true });
    expect(addresses.find(a => a.isDefault).id).toBe(id);
    expect(addresses.filter(a => a.isDefault)).toHaveLength(1);
  });
});

describe('default / remove / sort', () => {
  test('setDefaultAddress and sortAddresses put the default first', () => {
    const list = upsertAddress(upsertAddress([], A).addresses, B).addresses;
    const bId = list.find(a => a.line1 === B.line1).id;
    const next = setDefaultAddress(list, bId);
    expect(defaultAddress(next).id).toBe(bId);
    expect(sortAddresses(next)[0].id).toBe(bId);
  });
  test('removing the default promotes another address', () => {
    const list = upsertAddress(upsertAddress([], A).addresses, B).addresses;
    const aId = list.find(a => a.isDefault).id;
    const next = removeAddress(list, aId);
    expect(next).toHaveLength(1);
    expect(next[0].isDefault).toBe(true);
  });
  test('removing the last address leaves an empty list', () => {
    const list = upsertAddress([], A);
    expect(removeAddress(list.addresses, list.id)).toEqual([]);
  });
});

describe('helpers', () => {
  test('addressKey ignores case and extra spaces', () => {
    expect(addressKey({ line1: ' 12  Main Road ', pincode: '411001' })).toBe(addressKey(A));
  });
  test('orderAddressOf strips ids and flags', () => {
    expect(Object.keys(orderAddressOf({ ...A, id: 'x', isDefault: true, type: 'Home' })).sort())
      .toEqual(['city', 'line1', 'line2', 'name', 'phone', 'pincode', 'state']);
  });
});
