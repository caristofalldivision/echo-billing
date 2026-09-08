"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CaptivePortalTheme } from "@/lib/supabase/types";

const DEFAULTS: Omit<CaptivePortalTheme, "id" | "org_id" | "mikrotik_device_id" | "updated_at"> = {
  logo_url: null,
  primary_color: "#5B5FEF",
  secondary_color: "#FFB84D",
  theme: "waves",
  headline: "Get Connected",
  tagline: "Fast, affordable WiFi — pay and you're online in seconds.",
  terms_text: null,
  support_phone: null,
  support_whatsapp: null,
};

// Mirrors the token defaults each [data-theme] block sets in
// apps/captive-portal/src/style.css — kept here only for the picker swatch
// and live-preview approximation, not consumed by the real captive portal.
const THEME_PRESETS: {
  id: string;
  label: string;
  description: string;
  bg: string;
  surface: string;
  radius: string;
  font: string;
  dark?: boolean;
}[] = [
  { id: "waves", label: "Waves", description: "Warm, hand-drawn — the original design.", bg: "#fbf4e8", surface: "#ffffff", radius: "20px", font: "ui-rounded, sans-serif" },
  { id: "mono", label: "Mono", description: "Flat black & white, sharp corners.", bg: "#ffffff", surface: "#ffffff", radius: "4px", font: "ui-monospace, monospace" },
  { id: "sunrise", label: "Sunrise", description: "Warm gradient, soft blob shapes.", bg: "#fff2e6", surface: "#fffaf3", radius: "28px", font: "ui-rounded, sans-serif" },
  { id: "circuit", label: "Circuit", description: "Dark, techy grid, monospace.", bg: "#0a0f14", surface: "#101821", radius: "10px", font: "ui-monospace, monospace", dark: true },
  { id: "garden", label: "Garden", description: "Pastel, organic, serif type.", bg: "#f3f7ec", surface: "#ffffff", radius: "24px", font: "Georgia, serif" },
  { id: "midnight", label: "Midnight", description: "True dark mode, glassy surfaces.", bg: "#0d0d1a", surface: "rgba(255,255,255,0.12)", radius: "22px", font: "ui-rounded, sans-serif", dark: true },
];

export default function PortalThemePage() {
  const supabase = createClient();
  const [theme, setTheme] = useState(DEFAULTS);
  const [themeId, setThemeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("captive_portal_themes")
        .select("*")
        .is("mikrotik_device_id", null)
        .maybeSingle();
      if (data) {
        setTheme(data);
        setThemeId(data.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    setSaving(true);
    const { data: org } = await supabase.from("organizations").select("id").single();
    if (themeId) {
      await supabase.from("captive_portal_themes").update(theme).eq("id", themeId);
    } else {
      const { data } = await supabase
        .from("captive_portal_themes")
        .insert({ ...theme, org_id: org!.id })
        .select()
        .single();
      if (data) setThemeId(data.id);
    }
    setSaving(false);
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const path = `logo-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("branding").upload(path, file, { upsert: true });
    if (!error) {
      const { data: pub } = supabase.storage.from("branding").getPublicUrl(path);
      setTheme((t) => ({ ...t, logo_url: pub.publicUrl }));
    }
    setUploading(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-signal-ink">Captive portal</h1>
        <p className="text-sm text-signal-ink-dim">Customize the page customers see when they join your WiFi.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Logo</label>
            <input type="file" accept="image/*" onChange={handleLogoUpload} className="text-sm" />
            {uploading && <p className="mt-1 text-xs text-signal-ink-dim">Uploading…</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Primary color</label>
              <input
                type="color"
                className="h-10 w-full rounded-none border-2 border-signal-border"
                value={theme.primary_color}
                onChange={(e) => setTheme({ ...theme, primary_color: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Accent color</label>
              <input
                type="color"
                className="h-10 w-full rounded-none border-2 border-signal-border"
                value={theme.secondary_color}
                onChange={(e) => setTheme({ ...theme, secondary_color: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Theme</label>
            <div className="grid grid-cols-3 gap-2">
              {THEME_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setTheme({ ...theme, theme: preset.id })}
                  className={`flex flex-col items-start gap-1 rounded-none border-2 p-2 text-left transition-colors ${
                    theme.theme === preset.id ? "border-signal-ink" : "border-signal-border"
                  }`}
                  title={preset.description}
                >
                  <div
                    className="h-8 w-full"
                    style={{ background: preset.bg, borderRadius: preset.radius }}
                  >
                    <div
                      className="m-1 h-3 w-1/2"
                      style={{ background: theme.primary_color, borderRadius: preset.radius }}
                    />
                  </div>
                  <span className="text-xs font-semibold">{preset.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Headline</label>
            <input
              className="input"
              value={theme.headline}
              onChange={(e) => setTheme({ ...theme, headline: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Tagline</label>
            <input
              className="input"
              value={theme.tagline ?? ""}
              onChange={(e) => setTheme({ ...theme, tagline: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Support phone</label>
              <input
                className="input"
                value={theme.support_phone ?? ""}
                onChange={(e) => setTheme({ ...theme, support_phone: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Support WhatsApp</label>
              <input
                className="input"
                value={theme.support_whatsapp ?? ""}
                onChange={(e) => setTheme({ ...theme, support_whatsapp: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Terms text (optional)</label>
            <textarea
              className="input h-24"
              value={theme.terms_text ?? ""}
              onChange={(e) => setTheme({ ...theme, terms_text: e.target.value })}
            />
          </div>
          <button className="btn-primary self-start" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save theme"}
          </button>
          <p className="text-xs text-signal-ink-dim">
            After saving, rebuild &amp; re-push the captive portal bundle from{" "}
            <code>apps/captive-portal</code> so routers pick up the change on next provisioning refresh.
          </p>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-signal-ink-dim">Live preview</p>
          {(() => {
            const preset = THEME_PRESETS.find((p) => p.id === theme.theme) ?? THEME_PRESETS[0];
            const textColor = preset.dark ? "#f2f2f7" : "#241a15";
            return (
              <div
                className="flex aspect-[9/16] w-full max-w-sm flex-col items-center justify-center gap-4 overflow-hidden p-8 text-center shadow-echo"
                style={{ backgroundColor: preset.bg, fontFamily: preset.font }}
              >
                {theme.logo_url && <img src={theme.logo_url} alt="" className="h-14" />}
                <h2 className="text-2xl font-bold" style={{ color: theme.primary_color }}>
                  {theme.headline}
                </h2>
                <p className="text-sm" style={{ color: textColor, opacity: 0.7 }}>
                  {theme.tagline}
                </p>
                <div
                  className="w-full px-4 py-3 text-sm font-semibold text-white shadow-echo"
                  style={{ backgroundColor: theme.primary_color, borderRadius: preset.radius }}
                >
                  Buy WiFi Access
                </div>
                <div
                  className="w-full border-2 border-dashed px-4 py-3 text-sm font-semibold"
                  style={{ borderColor: theme.secondary_color, color: theme.secondary_color, borderRadius: preset.radius, background: preset.surface }}
                >
                  I have a voucher
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
