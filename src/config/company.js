// Single source of truth for Brightlight Solutions' public company details.
// Anything shown to a customer (header, footer, contact page, policies, WhatsApp
// links, page metadata) should read from here instead of hardcoding it, so the
// details only ever need changing in one place.

export const COMPANY = {
  name: 'Brightlight Solutions',
  shortName: 'Brightlight',
  tagline: 'Technology That Moves Business Forward',

  phoneDisplay: '+91 78450 81278',
  phoneTel: '+917845081278',
  // wa.me expects digits only, country code first, no "+".
  whatsappNumber: '917845081278',

  email: 'contact@brightlightsolutions.in',

  website: 'https://www.brightlightsolutions.in',
  websiteDisplay: 'www.brightlightsolutions.in',

  addressLines: ['Kamatchi Amman Kovil Street', 'Kumarananthapuram, Tiruppur', 'Tamil Nadu 641602, India'],
  addressOneLine: 'Kamatchi Amman Kovil Street, Kumarananthapuram, Tiruppur, Tamil Nadu 641602, India',

  hours: '24 Hours',

};

// Default pre-filled message for "Chat on WhatsApp" entry points.
export const DEFAULT_WA_MESSAGE = `Hi,
I'd like some help with shopping at ${COMPANY.name}.
Could you please help me?`;

// Builds a wa.me link to the company's WhatsApp number. `text` is optional.
export function whatsappLink(text) {
  const base = `https://wa.me/${COMPANY.whatsappNumber}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
