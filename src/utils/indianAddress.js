// Shared by every address form in the app (Checkout.jsx's shipping/billing
// fields, Account.jsx's AddressTab) so the state list and pincode lookup
// never drift between them.
export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra',
  'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim',
  'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

// India Post's public, keyless pincode lookup -- pure convenience autofill
// for City/State once a valid 6-digit PIN is typed. Never trusted for
// anything server-side: the address is still sent as the plain text the
// customer sees on screen (editable, same as if they'd typed it themselves).
export async function lookupPincode(pincode) {
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pincode}`);
    const data = await res.json();
    const po = data?.[0]?.Status === 'Success' ? data[0].PostOffice?.[0] : null;
    return po ? { city: po.District, state: po.State } : null;
  } catch { return null; }
}

// We only ship within India -- Checkout uses this to block placing an order
// against a pincode India Post affirmatively says doesn't exist. Distinct
// from lookupPincode's plain null: that also fires on a network hiccup or an
// unrecognized response shape, neither of which should ever block a genuine
// Indian customer over a third-party API being briefly unreachable, so only
// an explicit Status:"Error" (a real, checked "no such PIN code") counts as
// confirmed-invalid here -- anything else fails open, same convention as
// lookupPincode's own "never trusted, convenience only" stance above.
export async function isPincodeConfirmedInvalid(pincode) {
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pincode}`);
    const data = await res.json();
    return data?.[0]?.Status === 'Error';
  } catch { return false; }
}
