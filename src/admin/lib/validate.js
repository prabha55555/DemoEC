// Small field validators shared by the settings screens (and available to every admin form). Each returns an
// error sentence, or '' when the value is fine -- so `error={checkNumber(v, …)}` plugs straight into <Field>.

// raw: the string a NumberInput / MoneyInput holds. Options: { required, min, max, integer, label }.
export function checkNumber(raw, { required = false, min, max, integer = false, label = 'This' } = {}) {
  const s = String(raw ?? '').trim();
  if (s === '') return required ? `${label} is required.` : '';
  const n = Number(s);
  if (!Number.isFinite(n)) return `${label} must be a number.`;
  if (integer && !Number.isInteger(n)) return `${label} must be a whole number.`;
  if (min !== undefined && n < min) return min === 0 ? `${label} cannot be negative.` : `${label} must be at least ${min}.`;
  if (max !== undefined && n > max) return `${label} must be at most ${max}.`;
  return '';
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (v) => EMAIL.test(String(v ?? '').trim());
export function checkEmail(raw, { required = false, label = 'Email' } = {}) {
  const s = String(raw ?? '').trim();
  if (!s) return required ? `${label} is required.` : '';
  return isEmail(s) ? '' : `${label} does not look like a valid address.`;
}

// Indian phone numbers: optional +91 / 0, then 10 digits starting 6-9. Landlines are not checked.
export function checkPhone(raw, { required = false, label = 'Phone number' } = {}) {
  const s = String(raw ?? '').replace(/[\s()-]/g, '');
  if (!s) return required ? `${label} is required.` : '';
  return /^(?:\+?91|0)?[6-9]\d{9}$/.test(s) ? '' : `${label} should be a 10-digit Indian mobile number.`;
}

// True when any value in an errors object is a non-empty message.
export const hasErrors = (errors) => Object.values(errors || {}).some(Boolean);
