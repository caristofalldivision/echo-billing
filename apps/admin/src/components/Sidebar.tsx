"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[17px] w-[17px] shrink-0"
      {...props}
    />
  );
}

type Accent = "brand" | "pulse" | "voucher" | "alert";

const ACCENT_BORDER: Record<Accent, string> = {
  brand: "border-signal-chrome-brand",
  pulse: "border-signal-chrome-pulse",
  voucher: "border-signal-chrome-voucher",
  alert: "border-signal-chrome-alert",
};

const GROUPS: {
  label: string;
  accent: Accent;
  items: { href: string; label: string; icon: (p: SVGProps<SVGSVGElement>) => React.ReactElement }[];
}[] = [
  {
    label: "Overview",
    accent: "brand",
    items: [
      {
        href: "/",
        label: "Dashboard",
        icon: (p) => (
          <Icon {...p}>
            <path d="M3 13h4v8H3zM10 3h4v18h-4zM17 8h4v13h-4z" />
          </Icon>
        ),
      },
      {
        href: "/accounting",
        label: "Accounting",
        icon: (p) => (
          <Icon {...p}>
            <path d="M3 20h18M5 20V10l4-3 4 3v10M13 20V6l4-2 4 2v14" />
          </Icon>
        ),
      },
      {
        href: "/notifications",
        label: "Notifications",
        icon: (p) => (
          <Icon {...p}>
            <path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
            <path d="M9.5 20a2.5 2.5 0 0 0 5 0" />
          </Icon>
        ),
      },
    ],
  },
  {
    label: "Network",
    accent: "pulse",
    items: [
      {
        href: "/devices",
        label: "MikroTiks",
        icon: (p) => (
          <Icon {...p}>
            <rect x="4" y="4" width="16" height="7" rx="1.5" />
            <rect x="4" y="13" width="16" height="7" rx="1.5" />
            <path d="M8 7.5h.01M8 16.5h.01" />
          </Icon>
        ),
      },
      {
        href: "/plans",
        label: "Plans",
        icon: (p) => (
          <Icon {...p}>
            <path d="M12 2 3 6v6c0 5 4 8.5 9 10 5-1.5 9-5 9-10V6l-9-4Z" />
          </Icon>
        ),
      },
      {
        href: "/vouchers",
        label: "Vouchers",
        icon: (p) => (
          <Icon {...p}>
            <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z" />
            <path d="M10 6v12" strokeDasharray="2 2" />
          </Icon>
        ),
      },
      {
        href: "/pppoe",
        label: "PPPoE",
        icon: (p) => (
          <Icon {...p}>
            <rect x="3" y="6" width="18" height="12" rx="2" />
            <path d="M7 10h10M7 14h6" />
          </Icon>
        ),
      },
    ],
  },
  {
    label: "People & payments",
    accent: "voucher",
    items: [
      {
        href: "/customers",
        label: "Customers",
        icon: (p) => (
          <Icon {...p}>
            <circle cx="9" cy="8" r="3.25" />
            <path d="M3.5 19c1-3.2 3.3-4.8 5.5-4.8s4.5 1.6 5.5 4.8" />
            <path d="M16 4.5c1.5.3 2.6 1.6 2.6 3.2 0 1.5-1 2.8-2.4 3.2M18.2 14.3c1.9.6 3.2 2.1 3.8 4.3" />
          </Icon>
        ),
      },
      {
        href: "/transactions",
        label: "Payments",
        icon: (p) => (
          <Icon {...p}>
            <rect x="2.5" y="5" width="19" height="14" rx="2" />
            <path d="M2.5 10h19" />
          </Icon>
        ),
      },
    ],
  },
  {
    label: "Portal & settings",
    accent: "alert",
    items: [
      {
        href: "/portal-theme",
        label: "Captive Portal",
        icon: (p) => (
          <Icon {...p}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3a6 6 0 0 0 0 18 1.5 1.5 0 0 0 1-2.6 1.5 1.5 0 0 1 1-2.6h1.5A2.5 2.5 0 0 0 18 13.3 9 9 0 0 0 12 3Z" />
            <path d="M8 11h.01M11 8h.01M15 10h.01" />
          </Icon>
        ),
      },
      {
        href: "/settings",
        label: "Settings",
        icon: (p) => (
          <Icon {...p}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.37 9a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.04Z" />
          </Icon>
        ),
      },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-5 border-r-2 border-signal-chrome-border bg-signal-chrome py-6 text-signal-chrome-ink">
      <div className="flex items-center gap-2.5 px-6">
        <img src="/logo-mark.svg" alt="" className="h-8 w-8" />
        <span className="font-mono text-base font-black tracking-tight">echo.console</span>
      </div>

      {/* Flat solid-color block strip — De Stijl's own idiom (Mondrian
          color blocks, not a soft gradient), reusing the captive portal's
          "colorful divider" idea in a way that actually fits this system's
          stated no-shadows/no-blur identity instead of fighting it. */}
      <div className="flex h-1.5 w-full">
        <span className="flex-1 bg-signal-chrome-brand" />
        <span className="flex-1 bg-signal-chrome-pulse" />
        <span className="flex-1 bg-signal-chrome-voucher" />
        <span className="flex-1 bg-signal-chrome-alert" />
      </div>

      <nav className="flex flex-col gap-5 overflow-y-auto px-4">
        {GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <p className="px-3 pb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-signal-chrome-ink-dim/70">
              {group.label}
            </p>
            {group.items.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              const ItemIcon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "group flex items-center gap-3 border-l-4 px-3 py-2.5 text-sm font-bold transition-all",
                    active
                      ? clsx("bg-white/10 text-signal-chrome-ink", ACCENT_BORDER[group.accent])
                      : "border-transparent text-signal-chrome-ink-dim hover:translate-x-0.5 hover:bg-white/5 hover:text-signal-chrome-ink",
                  )}
                >
                  <ItemIcon />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
