/**
 * Shared Echo design tokens — imported as a Tailwind preset by both
 * apps/admin and apps/captive-portal so the two surfaces stay visually
 * consistent. Ripple/sound-wave motif (fits "Echo"), warm doodle backdrop.
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        echo: {
          ink: "#1E1B2E",
          paper: "#FAF9F4",
          indigo: {
            50: "#F0F0FE",
            100: "#E0E1FD",
            300: "#A8A9F7",
            500: "#5B5FEF",
            600: "#4649D6",
            700: "#3638AD",
          },
          amber: {
            100: "#FFF1DA",
            300: "#FFD9A0",
            500: "#FFB84D",
            600: "#E89B2C",
          },
          mint: {
            100: "#E3FBEF",
            500: "#22C55E",
          },
          coral: {
            100: "#FEE9E7",
            500: "#EF4444",
          },
          muted: "#6B7280",
        },
      },
      fontFamily: {
        display: ["'Baloo 2'", "'Segoe UI'", "sans-serif"],
        body: ["'Inter'", "'Segoe UI'", "sans-serif"],
      },
      borderRadius: {
        echo: "1.25rem",
      },
      boxShadow: {
        echo: "0 10px 30px -12px rgba(30, 27, 46, 0.25)",
      },
    },
  },
};
