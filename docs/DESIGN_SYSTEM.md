# Brightlight Solutions — Design System ("Vibrant Marketplace · Fresh Teal + Warm Yellow")

Storefront and Admin share one palette. The logo gold lives **only in the logo wordmark**; the UI uses teal + yellow.

## Approved colour palette

| Role | Token | Value | Use |
|---|---|---|---|
| **Primary — Fresh Teal** | `--primary` | `#0F766E` (dark `#0B5F59`, deep `#083F3B`, bright `#14B8A6`, tint `#E4F6F3`, border `#B6E3DD`) | Header/bands (gradient), primary buttons, links, selected states |
| **Highlight — Warm Yellow** | `--sun` | `#FFC93C` (hover `#F5A700`, tint `#FFF5D1`) | One highlight CTA per view (Buy now / Shop now), badges, active indicators |
| Accent — Coral | `--coral` | `#FF5A4F` (tint `#FFE8E5`) | Wishlist hearts, pastel tiles — sparing |
| Ink / text | `--ink`, `--text` | `#1F2A28` | Headings, dark surfaces |
| Muted text | `--text-muted` | `#5F6B69` | Secondary text |
| Page background | `--bg` | `#F4F6F6` | Light grey canvas behind white cards |
| Surface | `--card` | `#FFFFFF` | Cards, drawers |
| Border | `--border` | `#E4E8E7` | Hairlines |
| Success / Warning / Danger / Info | `--success` `--warning` `--error` `--info` | `#0F7B53` / `#A15C00` / `#C0352B` / `#1D5FD1` | Status |
| Logo gold | `--brand` / `--brand-grad` | `#D9A21F` | The "light" in the wordmark only |

Typography: **DM Sans** for all UI text (weights 400/500/600; body 14 px, labels 12–13 px, section titles 18–22 px / 500, prices 16–18 px / 600) — Montserrat is used only for the logo wordmark. Shapes: flat, 4–8 px radii, 1 px hairline borders, almost no shadows, rectangular buttons.

## Structure (reference: Meesho + Flipkart)

* **Header**: white bar — logo, boxed search, small text links (Contact Us · Help Centre), Wishlist / Account / Cart as icon-over-label; below it a one-line text category row with an "All Categories" mega menu. Mobile: logo + icons, search row, flat bottom tab bar.
* **Home**: edge-to-edge banner carousel → perks strip → round category thumbnails → featured banner with four arch tiles → "Top Picks" product row → tinted "Fresh Arrivals" row → "Products For You" grid → two flat CTA blocks.
* **Product card**: flat bordered tile — image, small grey name, bold price, free-delivery text, outlined "Add to Cart" button.
* **Shop**: white title bar ("Showing 1 - N of N products") → left collapsible filter rail (Category with search, Price bands, Availability) + 4/5-column grid, "Sort by" dropdown; mobile = Filters drawer.
* **Admin**: white sidebar (grouped nav), top bar with search, KPI cards, recent orders, status badges, empty/loading states, pagination.

## Measurable acceptance criteria (Admin Panel)

| # | Criterion | Target | Result |
|---|---|---|---|
| 1 | WCAG AA contrast for palette text/background pairs | ≥ 4.5 : 1 | verified in the release check (see below) |
| 2 | No legacy colours from the previous designs in `Admin.jsx` (cream, olive, terracotta, old ink, indigo) | 0 | 0 |
| 3 | Horizontal page overflow at 360 / 768 / 1024 px on all 14 Admin tabs | none | none (checked on the previous palette; layout unchanged) |
| 4 | Fonts in use | Inter + Montserrat only | yes |
| 5 | Sidebar + top bar on all tabs; drawer below 1024 px | yes | yes |
| 6 | Designed empty / loading / error states; pagination > 25 products / > 20 orders | yes | yes |
| 7 | Business logic untouched: identical Supabase / API call inventory | equal | equal |
| 8 | `CI=true npm run build` has zero ESLint warnings; all tests pass | pass | pass |

Admin styles: `src/styles/admin.css` (scoped to `.adm`). Storefront tokens and components: `src/styles/globals.css`.
