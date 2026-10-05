// Used on the Help Centre page (src/pages/Care.jsx, route /help) until an admin customizes
// the help topics in Admin -> Brand Settings (stored as brand.care_guides). Also the starting
// point for that editor, so an admin's first edit isn't a blank list.
// Shape per topic: { material (the card title), icon, tagline, steps[], note }.
// These are general guidance only -- specific timelines, refund and warranty terms live in the
// Shipping Policy and Terms & Conditions pages and are referred to rather than repeated here.
export const CARE_GUIDES_DEFAULT = [
  {
    material: 'Ordering & Payments',
    icon: '◈',
    tagline: 'Everything you need to place an order with confidence.',
    steps: [
      'Browse the store, add the products you want to your cart and review it before checking out',
      'Sign in or create an account to place and track your orders',
      'Pay securely online through the payment options shown at checkout',
      'You will see an order confirmation once your payment has gone through',
      'Not sure which product to choose? Message us before you order and we will help you',
    ],
    note: 'For full details on pricing, payment and order confirmation, please read our Terms & Conditions.',
  },
  {
    material: 'Shipping & Delivery',
    icon: '✦',
    tagline: 'Know what to expect once your order is on its way.',
    steps: [
      'Delivery for physical products depends on your location and the item ordered',
      'Tracking details are shared once your order has been dispatched',
      'Please make sure your delivery address and phone number are correct at checkout',
      'Check your parcel on arrival and keep the packaging until you are sure everything is in order',
      'If anything looks wrong with a delivery, get in touch with us as soon as possible',
    ],
    note: 'Delivery timelines, charges and conditions are set out on our Shipping Policy page.',
  },
  {
    material: 'Returns & Refunds',
    icon: '◇',
    tagline: 'What to do if something is not right with your order.',
    steps: [
      'Please read the returns section of our Terms & Conditions before placing your order',
      'If an item arrives damaged, contact us promptly and keep the original packaging',
      'A clear unboxing video and photos help us review any damage claim quickly',
      'Include your order number and a short description of the issue when you write to us',
      'We will review what you send and get back to you with the next steps',
    ],
    note: 'Our returns, exchange and damage-claim conditions are stated in the Terms & Conditions. Please refer to them for the exact policy.',
  },
  {
    material: 'Product Information',
    icon: '❖',
    tagline: 'Choosing the right product.',
    steps: [
      'Read the product description, specifications and size or option details before you order',
      'Photos are for reference — minor variations in colour and finish are normal',
      'Check the available options (size, colour or variant) and select the one you need',
      'Look at the delivery estimate shown on the product page',
      'Not sure about something? Ask us on WhatsApp before you buy',
    ],
    note: 'If you need more details about a product, our team will be happy to help.',
  },
  {
    material: 'Product Care',
    icon: '◉',
    tagline: 'Simple habits that help your purchases last.',
    steps: [
      'Unpack carefully and read any care label, manual or quick-start guide included',
      'Store products in a clean, dry place away from excess heat and moisture',
      'Follow the care or usage instructions that come with the product',
      'Keep your order confirmation and the original packaging in case you need support later',
      'If a product does not work as expected, contact us before attempting any repairs yourself',
    ],
    note: 'Warranty coverage, where applicable, depends on the product. Please check the product details or ask us before you buy.',
  },
  {
    material: 'Account & Support',
    icon: '●',
    tagline: 'Managing your account and reaching our team.',
    steps: [
      'Use the Account page to view your orders and update your details',
      'Forgot your password? Use the reset link on the sign-in page',
      'Keep your account details private and sign out on shared devices',
      'Reach us by phone, WhatsApp, email or the contact form — we are available 24 hours',
      'Share your order number when you write to us so we can help you faster',
    ],
    note: 'For anything not covered here, visit the Contact page and our team will be happy to help.',
  },
];
