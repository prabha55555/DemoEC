import {
  categoryPath, deleteBlocker, findCategoryByText, isSlugTaken, nextSortOrder, parentChoices, reorderPatches, rollUpCounts, slugProblem,
  treeOptions, uniqueSlug, wouldCycle,
} from './categoryTools';

const cats = [
  { id: 'f', parent_id: null, name: 'Fashion', slug: 'fashion', sort_order: 1, active: true },
  { id: 'h', parent_id: null, name: 'Home & Kitchen', slug: 'home-kitchen', sort_order: 2, active: true },
  { id: 'm', parent_id: 'f', name: 'Men', slug: 'men', sort_order: 1, active: true },
  { id: 'w', parent_id: 'f', name: 'Women', slug: 'women', sort_order: 2, active: false },
  { id: 'k', parent_id: 'f', name: 'Kids', slug: 'kids', sort_order: 3, active: true },
  { id: 'd', parent_id: 'h', name: 'Decor', slug: 'decor', sort_order: 1, active: true },
];

describe('slugs', () => {
  test('uniqueSlug appends -2, -3 ... and ignores the category being edited', () => {
    expect(uniqueSlug('Men', cats)).toBe('men-2');
    expect(uniqueSlug('Men', cats, 'm')).toBe('men');
    expect(uniqueSlug('Home Decor', cats)).toBe('home-decor');
    expect(uniqueSlug('Men', [...cats, { id: 'x', slug: 'men-2' }])).toBe('men-3');
    expect(uniqueSlug('!!!', cats)).toBe('category');
  });
  test('isSlugTaken is case-insensitive', () => {
    expect(isSlugTaken('FASHION', cats)).toBe(true);
    expect(isSlugTaken('fashion', cats, 'f')).toBe(false);
  });
  test('slugProblem explains what is wrong', () => {
    expect(slugProblem('', cats)).toMatch(/required/);
    expect(slugProblem('Bad Slug', cats)).toMatch(/lowercase/);
    expect(slugProblem('a--b', cats)).toMatch(/lowercase/);
    expect(slugProblem('men', cats)).toMatch(/already used by "Men"/);
    expect(slugProblem('men', cats, 'm')).toBe('');
    expect(slugProblem('footwear', cats)).toBe('');
  });
});

describe('tree helpers', () => {
  test('treeOptions lists parents first with indented children and marks hidden ones', () => {
    const labels = treeOptions(cats).map(o => o.label);
    expect(labels).toEqual(['Fashion', '— Men', '— Women (hidden)', '— Kids', 'Home & Kitchen', '— Decor']);
    expect(treeOptions(cats, { excludeIds: ['f'] }).map(o => o.value)).toEqual(['h', 'd']);
  });
  test('categoryPath builds "Parent > Child"', () => {
    expect(categoryPath(cats, 'm')).toBe('Fashion > Men');
    expect(categoryPath(cats, 'f')).toBe('Fashion');
    expect(categoryPath(cats, 'nope')).toBe('');
  });
  test('findCategoryByText matches a path, slug or unique name and explains failures', () => {
    expect(findCategoryByText(cats, 'Fashion > Men').category.id).toBe('m');
    expect(findCategoryByText(cats, 'fashion>men').category.id).toBe('m');
    expect(findCategoryByText(cats, 'women').category.id).toBe('w');
    expect(findCategoryByText(cats, 'home-kitchen').category.id).toBe('h');
    expect(findCategoryByText(cats, '').category).toBeNull();
    expect(findCategoryByText(cats, 'Shoes').error).toMatch(/Unknown category/);
    const dup = [...cats, { id: 'm2', parent_id: 'h', name: 'Men', slug: 'men-2', sort_order: 9 }];
    expect(findCategoryByText(dup, 'Men').error).toMatch(/matches 2/);
    expect(findCategoryByText(dup, 'Home & Kitchen > Men').category.id).toBe('m2');
  });
});

describe('reorderPatches', () => {
  test('moves a category up and renumbers the siblings', () => {
    expect(reorderPatches(cats, 'w', -1)).toEqual([{ id: 'w', sort_order: 1 }, { id: 'm', sort_order: 2 }]);
    expect(reorderPatches(cats, 'm', 1)).toEqual([{ id: 'w', sort_order: 1 }, { id: 'm', sort_order: 2 }]);
  });
  test('the first cannot go up and the last cannot go down', () => {
    expect(reorderPatches(cats, 'm', -1)).toEqual([]);
    expect(reorderPatches(cats, 'k', 1)).toEqual([]);
    expect(reorderPatches(cats, 'unknown', 1)).toEqual([]);
  });
  test('equal sort_order values still produce a real move', () => {
    const tied = [{ id: 'a', parent_id: null, name: 'A', sort_order: 0 }, { id: 'b', parent_id: null, name: 'B', sort_order: 0 }, { id: 'c', parent_id: null, name: 'C', sort_order: 0 }];
    const patches = reorderPatches(tied, 'c', -1);
    expect(patches.find(p => p.id === 'c').sort_order).toBe(2);
    expect(patches.find(p => p.id === 'b').sort_order).toBe(3);
  });
  test('nextSortOrder is one past the largest sibling', () => {
    expect(nextSortOrder(cats, 'f')).toBe(4);
    expect(nextSortOrder(cats, null)).toBe(3);
    expect(nextSortOrder(cats, 'k')).toBe(1);
  });
});

describe('parent / delete rules', () => {
  test('only roots can be parents; a category with children must stay a root', () => {
    expect(parentChoices(cats, 'm').map(c => c.id)).toEqual(['f', 'h']);
    expect(parentChoices(cats, 'f')).toEqual([]);
    expect(parentChoices(cats, null).map(c => c.id)).toEqual(['f', 'h']);
  });
  test('wouldCycle', () => {
    expect(wouldCycle(cats, 'f', 'm')).toBe(true);
    expect(wouldCycle(cats, 'f', 'f')).toBe(true);
    expect(wouldCycle(cats, 'm', 'h')).toBe(false);
    expect(wouldCycle(cats, 'm', null)).toBe(false);
  });
  test('deleteBlocker names the counts and the way out', () => {
    expect(deleteBlocker({ name: 'Men', childCount: 0, productCount: 0 })).toBeNull();
    expect(deleteBlocker({ name: 'Men', childCount: 0, productCount: 3 })).toMatch(/3 products.*Move the products/);
    expect(deleteBlocker({ name: 'Fashion', childCount: 1, productCount: 0 })).toMatch(/1 sub-category/);
    expect(deleteBlocker({ name: 'Fashion', childCount: 2, productCount: 1 })).toMatch(/2 sub-categories and 1 product/);
  });
  test('rollUpCounts adds descendants to the total', () => {
    const r = rollUpCounts(cats, { m: 4, w: 1, f: 2, d: 5 });
    expect(r.f).toEqual({ own: 2, total: 7 });
    expect(r.m).toEqual({ own: 4, total: 4 });
    expect(r.h).toEqual({ own: 0, total: 5 });
  });
});
