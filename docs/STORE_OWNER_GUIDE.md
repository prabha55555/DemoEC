# Store owner guide

A plain-language guide to running the store from the admin panel (`/admin`). No technical knowledge needed.
For installation and deployment see the [README](../README.md); for *why* the store behaves as it does see
[ECOMMERCE_REDESIGN.md](ECOMMERCE_REDESIGN.md).

> There is **one admin account** (the e-mail set as `REACT_APP_ADMIN_EMAIL`). There are no staff roles yet — anyone
> you give that login to can do everything below, including refunds.

---

## 1. Your day in five minutes

Open **Dashboard**. The tiles tell you what needs you today:

| Tile | What to do |
|---|---|
| **Orders awaiting action** | Open Orders, work through *Placed → Confirmed → Packed* |
| **Returns to review** | Open Returns, approve or reject each request |
| **Low-stock items** | Open Inventory, restock (use *Quick restock* when a delivery arrives) |
| **Reviews to moderate** | Open Reviews, approve or reject |
| **Orders flagged for stock** | A customer paid after the stock hold had expired and there was no stock left. Contact them, then cancel (refunds automatically) or fulfil from new stock and press *Mark resolved* |
| **New customer queries** | Reply by WhatsApp or e-mail from Customer queries |

The numbers in the left menu (Orders, Returns, Inventory …) are the same counts.

---

## 2. Looking after an order

**Sales → Orders**, then click an order. The big green button is always the *next* step:

```
Placed → Confirm → Mark packed → Mark shipped → Out for delivery → Mark delivered
```

- **Mark shipped** asks for the courier, tracking number and tracking link (all optional, but customers ask). The
  customer sees them on their order page; the link must start with `https://`.
- Every step has a switch **"Notify the customer by e-mail / WhatsApp"**. It is on when a message exists for that
  step. Turn it off to change a status quietly. A short **note** goes on the order timeline, which the *customer can
  see* (use *Internal notes* on the order for private remarks).
- **Update status** lets you skip ahead (for example straight to *Shipped*). You cannot go backwards, and *Delivered*
  is final.
- **Cash on Delivery** orders show *Pay on delivery*. When you mark one *Delivered* the cash is recorded as collected
  and it becomes *Paid*.
- **Print** gives a packing slip / invoice; the customer can also download their own invoice (with GST split).
- **Bulk actions**: tick several orders in the list to move them forward together; **Export CSV** downloads the list.

### Cancelling
**Cancel order** is available until the order is delivered. In one step the system: marks it *Cancelled*, puts the
items back in stock, gives the coupon use back, credits any gift card used, and refunds the online payment to the
customer's original method (usually 5–7 business days). Customers can cancel by themselves only until the order is
*Packed*; after it ships they must ask you.

### Refunds
**Issue refund** on an order's Payment card. The rules (the system enforces them even if two people click at once):

- You can never refund more than was charged.
- **Before delivery** you can refund only *part* of an order (for example ₹50 for a late dispatch) and at least ₹1 must
  stay. To give *all* the money back, **cancel the order** instead — that also fixes stock and the coupon.
- **After delivery** you can refund any amount up to what was charged.
- **Online payments** go back through Razorpay. If Razorpay refuses, the screen tells you why, the attempt shows as
  *failed*, nothing is counted as refunded, and you can try again.
- **Cash on Delivery**: nothing can be refunded until the cash has been collected (after *Delivered*). A COD refund is
  only a **record** ("manual refund") — you pay the customer yourself (UPI / bank transfer).
- An order that **bought a gift card** cannot be refunded on its own: cancel it (the card is voided first, and only if
  it is still unspent).
- A **cancelled online order whose refund failed** shows an orange warning on the order. Refund it from the Razorpay
  dashboard, or press *Retry with Issue refund*.

---

## 3. Returns and replacements

Customers request a return from *My orders* once the order is delivered, inside the return window (default 7 days;
each product can have its own, set on the product). **Sales → Returns**:

1. **Approve** (or **Reject** with a note — the customer is e-mailed).
2. Optionally **Pickup scheduled**, then **Mark received** when the goods are back.
3. **Refund**: the amount is pre-filled with what the customer actually paid for those items *after* any coupon. You can
   change it, and tick/untick **Restock the returned items** (untick if they are damaged). A full refund marks the
   order *Returned*.
4. Or **Close without refund**.

---

## 4. Products, categories and stock

### Products (Catalogue → Products)
- **Add product**: name, brand, category, description, images, then **options** (for example *Size*, *Colour*). The
  option combinations become **variants**, each with its own SKU, price, MRP (the crossed-out price), stock and
  on/off switch. A product with no options has one *Default* variant.
- Category-specific fields (for example *Fabric* for clothing) appear automatically — they come from the category.
- **Status**: *Draft* (hidden), *Active* (visible and buyable), *Archived* (hidden, kept for records). A product can
  only be **deleted** if it has never been sold — otherwise archive it.
- **Duplicate** copies a product as a draft. **Import / Export CSV** edits many products at once; a bad file shows the
  problem row by row and gives you an error report to download.
- Stock is changed in **Inventory**, not by typing a number into the product, so every change leaves a record.

### Categories (Catalogue → Categories)
Groups and sub-categories drive the store menu and filters. Each category carries its own attribute fields (which are
shown on the product page and which can be used as shop filters) and a GST rate. Switch a category off to hide it.

### Inventory (Catalogue → Inventory)
- **Stock** tab: units in stock, low/out counts, stock value; filter by *low*, *out* or *untracked*.
- **Quick restock**: enter received quantities for many variants in one go.
- **Adjust**: add, remove or set a quantity with a reason. The count cannot go below zero.
- **Stock ledger**: every movement (sale, cancel, return, restock, manual change) with who and why; export it.
- Customers can ask to be told when a sold-out item returns — see **Messaging → Stock alerts**.

---

## 5. Marketing

- **Coupons**: percentage or flat amount; minimum order; maximum discount; dates; usage limits; apply to everything, to
  certain categories or products; *first order only*. **Public** coupons are suggested at checkout; **private** ones
  work only when typed in. A coupon that stops being valid is switched off, never deleted, so old orders still make
  sense.
- **Gift cards**: turn the feature on/off, set the minimum/maximum amount and validity. Cards are created when a
  customer buys one and are spent at checkout.
- **Reviews**: only customers with a *delivered* order can review a product. Approve or reject; star ratings update
  by themselves.
- **Banners / Blog posts**: the home-page slider and the Insights articles.

---

## 6. Reports

**Reports** (India time). Choose *Today, 7 days, 30 days, This month, Last month* or a custom range:
Sales, Products, Categories, Coupons, Payments and a **GST summary** for filing. *Net sales = sales − refunds*;
cancelled orders are left out. Customers has a total per customer and an **Export CSV**.

---

## 7. Messages to customers

Messaging → **Email templates** / **WhatsApp templates**. Ready-made messages exist for: order placed, shipped, out for
delivery, delivered, cancelled, refund processed, and return requested / approved / rejected. They send automatically
as long as the template is **enabled**; edit the wording (use the clickable `{{variables}}`) or switch one off. If you
switch a template off, that message simply isn't sent. **Email test** sends a sample to check your sender setup.

---

## 8. Store settings (Storefront → Store settings)

| Tab | What it controls |
|---|---|
| **General** | Logo, name, tagline, social links, registered office |
| **About & media** | About page images and video |
| **Help Centre** | Contact details and help topics |
| **Shipping & delivery** | Free-delivery threshold (default ₹499, judged *before* coupons), delivery fee for metro / other cities, delivery-time estimates |
| **Payments** | **Cash on Delivery** on/off (off by default), COD fee, largest COD order. Online payment keys live on the server, not here |
| **Tax & invoice** | Seller legal name, GSTIN, state, default GST rate. Prices already include GST; invoices split it |
| **Returns & stock** | Default return window, low-stock level |

Changes save with the bar at the bottom ("Save changes"). If a save fails the screen says so — it never pretends.

---

## 9. When something looks wrong

| You see | What it means / what to do |
|---|---|
| **"Please sign in again"** on any admin page | Your login is out of date. Press *Sign out and sign in again*. |
| A customer says "I paid but have no order" | Open **Payments** in Razorpay. A safety-net webhook creates the order within moments; if it doesn't, check the webhook URL and secret in the README. |
| Order card says **refund did not go through** | See *Refunds* above. Nothing was lost: the amount is still owed and visible. |
| A product isn't in the shop | Is it *Active*, is its category switched on, and does it have at least one variant with price and stock? |
| Customer didn't get an e-mail | Is the template enabled? Is the Brevo sender verified? Try **Email test**. The order's timeline notes whether a message was sent. |
| Stock looks wrong | **Inventory → Stock ledger** shows every change and who made it. |

---

## 10. Before you go live — checklist

1. Run `supabase/schema.sql` in the Supabase SQL editor **before** deploying the code.
2. Put the production domain (and `http://localhost:3000` for development) in Supabase → Authentication → URL Configuration
   → **Redirect URLs** in the form `https://your-domain/**` and `http://localhost:3000/**` (the trailing `/**` matters:
   password-reset links return to `/reset-password`). Google sign-in also needs the Supabase callback
   `https://<project-ref>.supabase.co/auth/v1/callback` as an *authorised redirect URI* in Google Cloud Console.
3. Fill in the environment variables on Vercel (README, section 2) and add the Razorpay webhook.
4. Store settings → Tax & invoice: seller name, GSTIN, state. Shipping and Payments: your real fees.
5. Delete the demo catalogue (README section 1, step 3) and add real products and photos.
6. **Place a real test order** with Razorpay *test mode*, then one with Cash on Delivery, and take each through
   shipped → delivered → return → refund. (Only the fake payment gateway has been exercised so far; real Razorpay,
   Brevo and WhatsApp have not.)
7. Check the e-mail and WhatsApp wording in Messaging, and send yourself an **Email test**.
