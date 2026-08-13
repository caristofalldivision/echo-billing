# @echo/doodles

Shared design tokens + hand-drawn SVG set for Echo, used by both `apps/admin` and `apps/captive-portal`.

- `tailwind-preset.js` — colors (`echo-indigo`, `echo-amber`, `echo-mint`, `echo-coral`, `echo-ink`, `echo-paper`), fonts, radii, shadows. Import as a Tailwind preset:
  ```js
  // tailwind.config.js
  presets: [require("@echo/doodles/tailwind-preset.js")]
  ```
- `logo-mark.svg` — ripple/soundwave mark, works as a favicon base or navbar mark.
- `doodle-waves.svg` — wide hero illustration (router + phone + wavy ground lines), used on the captive portal landing screen and admin login/empty states.
- `doodle-success.svg` — payment-success checkmark badge.
- `doodle-empty.svg` — generic "nothing here yet" illustration (empty vouchers/devices/customers lists).
- `doodle-voucher.svg` — ticket-style voucher graphic.

Brand motif: concentric ripple arcs (the "echo" of a signal going out) in indigo (`#5B5FEF`) with warm amber (`#FFB84D`) accents, on a soft paper background (`#FAF9F4`) rather than stark white — keeps the hand-drawn feel from looking clinical.
