import Link from "next/link";

const SECTIONS = [
  { href: "/settings/payments", title: "Payments", desc: "Pesapal consumer key/secret and environment", icon: "💳" },
  { href: "/settings/sms", title: "SMS", desc: "TalkSasa API key and sender ID", icon: "📩" },
  { href: "/settings/email", title: "Email", desc: "Resend API key and from address", icon: "✉️" },
  { href: "/settings/team", title: "Team", desc: "Add staff accounts and manage roles", icon: "🧑‍🤝‍🧑" },
  { href: "/settings/account", title: "Account", desc: "Your email and password", icon: "🔐" },
];

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-echo-ink">Settings</h1>
        <p className="text-sm text-echo-muted">Provider credentials for payments, SMS, and email.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="card flex flex-col gap-2 hover:shadow-lg">
            <span className="text-2xl">{s.icon}</span>
            <h3 className="font-display text-lg font-bold">{s.title}</h3>
            <p className="text-sm text-echo-muted">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
