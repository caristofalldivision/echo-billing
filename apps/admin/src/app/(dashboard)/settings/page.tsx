import Link from "next/link";
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
      className="h-6 w-6 text-signal-brand"
      {...props}
    />
  );
}

const SECTIONS = [
  {
    href: "/settings/payments",
    title: "Payments",
    desc: "Pesapal consumer key/secret and environment",
    icon: (
      <Icon>
        <rect x="2.5" y="5" width="19" height="14" rx="2" />
        <path d="M2.5 10h19" />
      </Icon>
    ),
  },
  {
    href: "/settings/sms",
    title: "SMS",
    desc: "TalkSasa API key and sender ID",
    icon: (
      <Icon>
        <path d="M4 5h16v11H8l-4 4V5Z" />
      </Icon>
    ),
  },
  {
    href: "/settings/email",
    title: "Email",
    desc: "Resend API key and from address",
    icon: (
      <Icon>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m4 7 8 6 8-6" />
      </Icon>
    ),
  },
  {
    href: "/settings/team",
    title: "Team",
    desc: "Add staff accounts and manage roles",
    icon: (
      <Icon>
        <circle cx="9" cy="8" r="3.25" />
        <path d="M3.5 19c1-3.2 3.3-4.8 5.5-4.8s4.5 1.6 5.5 4.8" />
        <path d="M16 4.5c1.5.3 2.6 1.6 2.6 3.2 0 1.5-1 2.8-2.4 3.2M18.2 14.3c1.9.6 3.2 2.1 3.8 4.3" />
      </Icon>
    ),
  },
  {
    href: "/settings/account",
    title: "Account",
    desc: "Your email and password",
    icon: (
      <Icon>
        <rect x="4" y="10" width="16" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </Icon>
    ),
  },
];

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-signal-ink">Settings</h1>
        <p className="text-sm text-signal-ink-dim">Provider credentials for payments, SMS, and email.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="card flex flex-col gap-2 transition hover:bg-signal-brand-soft">
            {s.icon}
            <h3 className="text-lg font-bold text-signal-ink">{s.title}</h3>
            <p className="text-sm text-signal-ink-dim">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
