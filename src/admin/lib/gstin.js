// GSTIN (India's 15-character GST identification number) validation. Pattern check only -- the check
// digit is deliberately NOT verified, so a test/placeholder GSTIN that has the right shape still saves.
//
//   2 digits state code · 5 letters + 4 digits + 1 letter (the holder's PAN) · 1 entity digit (1-9 or A-Z)
//   · the letter Z · 1 check character
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// State / UT codes used in a GSTIN's first two digits.
export const GSTIN_STATE_CODES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

export const normaliseGstin = (v) => String(v ?? '').replace(/\s+/g, '').toUpperCase();

// -> { valid, value (normalised), message ('' when valid), stateName (from the code, or '') }.
// An empty GSTIN is valid: the field is optional.
export function validateGstin(raw) {
  const value = normaliseGstin(raw);
  if (!value) return { valid: true, value: '', message: '', stateName: '' };
  if (value.length !== 15) return { valid: false, value, message: `A GSTIN has 15 characters (you entered ${value.length}).`, stateName: '' };
  if (!GSTIN_PATTERN.test(value)) return { valid: false, value, message: 'This does not look like a valid GSTIN. Format: 33AAAAA0000A1Z5.', stateName: '' };
  const stateName = GSTIN_STATE_CODES[value.slice(0, 2)];
  if (!stateName) return { valid: false, value, message: `"${value.slice(0, 2)}" is not a valid state code for a GSTIN.`, stateName: '' };
  return { valid: true, value, message: '', stateName };
}
