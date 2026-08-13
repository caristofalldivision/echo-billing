import { defineConfig } from "vite";

// Entry is login.html (not index.html) on purpose — RouterOS's hotspot
// server looks for that exact filename in html-directory, and only inside
// that request does it substitute $(link-login-only)/$(link-orig)/etc.
// Output filenames are fixed (no content hash) because the router fetches
// them one-by-one by name during provisioning — see
// supabase/functions/_shared/router-template.ts CAPTIVE_PORTAL_FILES.
export default defineConfig({
  build: {
    rollupOptions: {
      input: "login.html",
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: (info) =>
          info.name && info.name.endsWith(".css") ? "assets/app.css" : "assets/[name][extname]",
      },
    },
  },
});
