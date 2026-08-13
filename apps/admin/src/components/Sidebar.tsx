"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const NAV = [
  { href: "/", label: "Dashboard", icon: "📡" },
  { href: "/devices", label: "MikroTiks", icon: "🛰️" },
  { href: "/plans", label: "Plans", icon: "📦" },
  { href: "/vouchers", label: "Vouchers", icon: "🎟️" },
  { href: "/customers", label: "Customers", icon: "👥" },
  { href: "/transactions", label: "Payments", icon: "💳" },
  { href: "/portal-theme", label: "Captive Portal", icon: "🎨" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-1 border-r border-echo-indigo-100/70 bg-white/70 px-4 py-6 backdrop-blur">
      <div className="mb-6 flex items-center gap-2 px-2">
        <img src="/logo-mark.svg" alt="" className="h-9 w-9" />
        <span className="font-display text-lg font-bold text-echo-ink">Echo</span>
      </div>
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
              active
                ? "bg-echo-indigo-500 text-white shadow-echo"
                : "text-echo-ink/80 hover:bg-echo-indigo-50",
            )}
          >
            <span>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </aside>
  );
}
