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

const NAV = [
  {
    href: "/",
    label: "Dashboard",
    icon: (p: SVGProps<SVGSVGElement>) => (
      <Icon {...p}>
        <path d="M3 13h4v8H3zM10 3h4v18h-4zM17 8h4v13h-4z" />
      </Icon>
    ),
  },
  {
    href: "/devices",
    label: "MikroTiks",
    icon: (p: SVGProps<SVGSVGElement>) => (
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
    icon: (p: SVGProps<SVGSVGElement>) => (
      <Icon {...p}>
        <path d="M12 2 3 6v6c0 5 4 8.5 9 10 5-1.5 9-5 9-10V6l-9-4Z" />
      </Icon>
    ),
  },
  {
    href: "/vouchers",
    label: "Vouchers",
    icon: (p: SVGProps<SVGSVGElement>) => (
      <Icon {...p}>
        <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z" />
        <path d="M10 6v12" strokeDasharray="2 2" />
      </Icon>
    ),
  },
  {
    href: "/customers",
    label: "Customers",
    icon: (p: SVGProps<SVGSVGElement>) => (
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
    icon: (p: SVGProps<SVGSVGElement>) => (
      <Icon {...p}>
        <rect x="2.5" y="5" width="19" height="14" rx="2" />
        <path d="M2.5 10h19" />
      </Icon>
    ),
  },
  {
    href: "/portal-theme",
    label: "Captive Portal",
    icon: (p: SVGProps<SVGSVGElement>) => (
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
    icon: (p: SVGProps<SVGSVGElement>) => (
      <Icon {...p}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.37 9a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.04Z" />
      </Icon>
    ),
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-1 border-r-2 border-signal-chrome-border bg-signal-chrome px-4 py-6 text-signal-chrome-ink">
      <div className="mb-6 flex items-center gap-2.5 border-b-2 border-signal-chrome-border px-2 pb-5">
        <img src="/logo-mark.svg" alt="" className="h-8 w-8" />
        <span className="font-mono text-base font-black tracking-tight">echo.console</span>
      </div>
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const ItemIcon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "flex items-center gap-3 px-3 py-2.5 text-sm font-bold transition",
              active
                ? "bg-signal-chrome-brand text-white"
                : "text-signal-chrome-ink-dim hover:bg-white/10 hover:text-signal-chrome-ink",
            )}
          >
            <ItemIcon />
            {item.label}
          </Link>
        );
      })}
    </aside>
  );
}
