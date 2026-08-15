/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require("@echo/signal/tailwind-preset.js")],
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
