import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useBrand } from '../../context/BrandContext';
import { friendlyDbError } from '../hooks/adminWrite';
import useUnsavedChanges from '../hooks/useUnsavedChanges';

// A form over the single-row `settings` table (read through BrandContext, written with updateBrand).
//
// It exists to fix one bug the old Brand Settings had: the form was seeded from `brand` ONCE at mount, and
// BrandContext starts with placeholder defaults and fetches the real row afterwards -- so opening the screen
// early and pressing Save could overwrite the real saved settings with the placeholders. Here the values are
// re-seeded the moment the real row arrives, and `canSave` stays false until then.
//
//   const form = useBrandForm({
//     initial:   (brand) => ({ fee: String(brand.shipping_fee_metro ?? 0) }),   // brand -> editable values (strings for inputs)
//     validate:  (v) => ({ fee: checkNumber(v.fee, { min: 0, label: 'The fee' }) }),   // -> { field: message }
//     toPayload: (v) => ({ shipping_fee_metro: Number(v.fee) }),                // values -> columns to write
//   });
//   form.values · form.set('fee', '40') · form.errors · form.dirty · form.loaded · form.canSave · form.saving
//   form.save() validates, writes via updateBrand, toasts, and marks the form clean · form.reset() discards edits
// Also registers the form with the unsaved-changes guard.
export default function useBrandForm({ initial, validate, toPayload, successMessage = 'Settings saved.' }) {
  const { brand, updateBrand, loading } = useBrand();
  const initialRef = useRef(initial);
  initialRef.current = initial;

  const [values, setValues] = useState(() => initial(brand));
  const [baseline, setBaseline] = useState(() => initial(brand));
  const [saving, setSaving] = useState(false);
  const synced = useRef(!loading);

  // The real row has arrived: replace the placeholder-seeded values once (never again, so an edit in progress survives).
  useEffect(() => {
    if (synced.current || loading) return;
    synced.current = true;
    const fresh = initialRef.current(brand);
    setValues(fresh);
    setBaseline(fresh);
  }, [loading, brand]);

  const loaded = !loading;
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);
  useUnsavedChanges(dirty);

  const errors = validate ? validate(values) : {};
  const hasErrors = Object.values(errors).some(Boolean);
  const set = useCallback((key, value) => setValues(v => ({ ...v, [key]: value })), []);
  const reset = useCallback(() => setValues(baseline), [baseline]);

  const save = useCallback(async () => {
    if (!loaded || saving) return false;
    if (hasErrors) { toast.error('Please fix the highlighted fields first.'); return false; }
    setSaving(true);
    try {
      await updateBrand(toPayload(values));
      setBaseline(values);
      toast.success(successMessage);
      return true;
    } catch (e) {
      toast.error(friendlyDbError(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, [loaded, saving, hasErrors, updateBrand, toPayload, values, successMessage]);

  return { values, set, setValues, errors, dirty, loaded, saving, canSave: loaded && dirty && !saving, save, reset };
}
