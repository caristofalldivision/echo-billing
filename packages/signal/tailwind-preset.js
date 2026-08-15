/**
 * Echo Signal — shared Tailwind preset for apps/admin and apps/landing.
 * De Stijl / Neoplasticism: flat primary colors, black rule lines, sharp
 * corners everywhere. Import globals.css once (defines the --signal-*
 * custom properties these tokens read) and add this as a Tailwind preset
 * alongside it.
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        signal: {
          bg: "var(--signal-bg)",
          "bg-elevated": "var(--signal-bg-elevated)",
          surface: "var(--signal-panel)",
          "surface-solid": "var(--signal-panel-solid)",
          border: "var(--signal-panel-border)",
          ink: "var(--signal-ink)",
          "ink-dim": "var(--signal-ink-dim)",
          "ink-faint": "var(--signal-ink-faint)",

          brand: "var(--signal-brand)",
          "brand-strong": "var(--signal-brand-strong)",
          "brand-soft": "var(--signal-brand-soft)",
          pulse: "var(--signal-pulse)",
          "pulse-soft": "var(--signal-pulse-soft)",
          voucher: "var(--signal-voucher)",
          "voucher-soft": "var(--signal-voucher-soft)",
          alert: "var(--signal-alert)",
          "alert-soft": "var(--signal-alert-soft)",

          chrome: "var(--signal-chrome-bg)",
          "chrome-2": "var(--signal-chrome-bg-2)",
          "chrome-panel": "var(--signal-chrome-panel)",
          "chrome-ink": "var(--signal-chrome-ink)",
          "chrome-ink-dim": "var(--signal-chrome-ink-dim)",
          "chrome-border": "var(--signal-chrome-border)",
          "chrome-brand": "var(--signal-chrome-brand)",
          "chrome-pulse": "var(--signal-chrome-pulse)",
          "chrome-voucher": "var(--signal-chrome-voucher)",
          "chrome-alert": "var(--signal-chrome-alert)",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Helvetica Neue"',
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          '"SF Mono"',
          '"Cascadia Code"',
          "Consolas",
          '"Liberation Mono"',
          "monospace",
        ],
      },
      borderRadius: {
        glass: "0px",
        chip: "0px",
        tight: "0px",
      },
      boxShadow: {
        glass: "none",
        "glass-sm": "none",
      },
      backdropBlur: {
        glass: "0px",
      },
    },
  },
};
