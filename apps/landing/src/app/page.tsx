import Link from "next/link";
import { ActivityIcon, ShieldIcon, SignalIcon } from "@/components/icons";
import { HeroIllustration } from "@/components/HeroIllustration";

const FEATURES = [
  {
    num: "01",
    swatch: "bg-signal-alert",
    icon: SignalIcon,
    title: "One-paste provisioning",
    body: "A single RouterOS script opens a WireGuard tunnel and hands the router its captive portal — no follow-up visit.",
  },
  {
    num: "02",
    swatch: "bg-signal-brand",
    icon: ActivityIcon,
    title: "Live, not eventually",
    body: "Sessions, vouchers redeemed, and revenue update over the wire the moment they happen, not on the next page refresh.",
  },
  {
    num: "03",
    swatch: "bg-signal-voucher",
    icon: ShieldIcon,
    title: "Idempotent by default",
    body: "Payments re-verify against the provider before a voucher is ever cut — retried webhooks don't double-charge anyone.",
  },
];

const TIERS = [
  {
    name: "Starter",
    features: ["1 router", "Hotspot vouchers", "Email support"],
    cta: "Choose Starter",
    style: "outline" as const,
  },
  {
    name: "Growth",
    features: ["Up to 10 routers", "PPPoE + hotspot", "M-Pesa STK push"],
    cta: "Choose Growth",
    style: "highlight" as const,
  },
  {
    name: "Scale",
    features: ["Unlimited routers", "Priority support", "Custom onboarding"],
    cta: "Talk to us",
    style: "outline" as const,
  },
];

export default function Home() {
  return (
    <>
      <nav className="flex items-center justify-between border-b-2 border-signal-ink px-6 py-4 sm:px-10">
        <div className="flex items-center gap-2.5 text-lg font-black tracking-tight">
          <span className="relative h-[22px] w-[22px] shrink-0 bg-signal-alert">
            <span className="absolute left-1.5 top-1.5 h-4 w-4 bg-signal-brand" />
          </span>
          ECHO
        </div>
        <div className="hidden gap-7 text-sm font-bold sm:flex">
          <a href="#features">Product</a>
          <a href="#console">Console</a>
          <a href="#pricing">Pricing</a>
        </div>
        <a
          href="#pricing"
          className="border-2 border-signal-ink bg-signal-brand px-4 py-2 text-xs font-bold text-white transition hover:bg-signal-ink"
        >
          Get started
        </a>
      </nav>

      <section className="grid border-b-2 border-signal-ink sm:grid-cols-12">
        <div className="flex flex-col justify-center gap-5 border-b-2 border-signal-ink px-6 py-14 sm:col-span-7 sm:border-b-0 sm:border-r-2 sm:px-14 sm:py-20">
          <div className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-signal-alert">
            RADIUS &middot; WIREGUARD &middot; NO FOLLOW-UP
          </div>
          <h1 className="text-[clamp(2.4rem,5vw,3.6rem)] font-black leading-[1.02] tracking-tight text-balance">
            <span className="block">Paste a script.</span>
            <span className="block">
              Router&apos;s <span className="text-signal-alert">live</span>.
            </span>
            <span className="block">
              Revenue&apos;s <span className="text-signal-brand">live</span>.
            </span>
          </h1>
          <p className="max-w-[42ch] text-base font-medium text-signal-ink-faint sm:text-lg">
            Echo turns any MikroTik into a self-service hotspot — vouchers, M-Pesa, PPPoE renewals —
            and streams every session back to one console the moment it happens.
          </p>
          <p className="max-w-[42ch] text-sm font-bold">
            Your customers buy access, get online, and never have to call you about it.
          </p>
          <div className="mt-2 flex flex-wrap gap-3.5">
            <a href="#console" className="btn-yellow border-signal-ink">
              See the console
            </a>
            <a href="#features" className="btn-outline border-signal-ink">
              How it works
            </a>
          </div>
        </div>

        <div className="flex flex-col sm:col-span-5">
          <div className="flex items-end border-b-2 border-signal-ink bg-signal-voucher p-4 font-mono text-xs font-black tracking-[0.08em] text-black">
            ECHO
          </div>
          <div className="flex-1 p-6">
            <HeroIllustration />
          </div>
        </div>
      </section>

      <section id="features" className="grid border-b-2 border-signal-ink sm:grid-cols-3">
        {FEATURES.map(({ num, swatch, icon: FeatureIcon, title, body }, i) => (
          <div
            key={title}
            className={`flex flex-col gap-3.5 p-8 sm:p-9 ${i < 2 ? "border-b-2 border-signal-ink sm:border-b-0 sm:border-r-2" : ""}`}
          >
            <span className={`h-8 w-8 ${swatch}`} />
            <div className="font-mono text-xs font-black">{num}</div>
            <h3 className="flex items-center gap-2 text-lg font-extrabold">
              <FeatureIcon className="h-5 w-5" />
              {title}
            </h3>
            <p className="text-sm font-medium text-signal-ink-faint">{body}</p>
          </div>
        ))}
      </section>

      <section id="console" className="grid border-b-2 border-signal-ink sm:grid-cols-[200px_1fr]">
        <nav className="hidden flex-col gap-0.5 border-r-2 border-signal-ink bg-signal-chrome py-5 text-signal-chrome-ink sm:flex">
          <div className="px-4 pb-4 font-mono text-sm font-black tracking-tight">ECHO.CONSOLE</div>
          <div className="flex items-center gap-2.5 bg-signal-chrome-brand px-4 py-2.5 text-sm font-bold text-white">
            <span className="h-2 w-2 bg-white" />
            Dashboard
          </div>
          {["Sessions", "Vouchers", "Devices", "Billing"].map((item) => (
            <div key={item} className="px-4 py-2.5 text-sm font-bold text-signal-chrome-ink-dim">
              {item}
            </div>
          ))}
        </nav>
        <div className="flex flex-col gap-5 p-6 sm:p-8">
          <div className="grid grid-cols-2 border-2 border-signal-ink sm:grid-cols-4">
            {[
              { label: "Active sessions", value: "214", swatch: "bg-signal-brand" },
              { label: "Revenue today", value: "48,230", swatch: "bg-signal-alert" },
              { label: "Vouchers", value: "1,042", swatch: "bg-signal-voucher" },
              { label: "Routers", value: "18/19", swatch: "bg-signal-ink" },
            ].map((s, i) => (
              <div
                key={s.label}
                className={`p-4 ${i % 2 === 0 ? "border-r-2 border-signal-ink sm:border-r-2" : ""} ${i < 2 ? "border-b-2 border-signal-ink sm:border-b-0" : ""} ${i === 1 ? "sm:border-r-2" : ""} ${i === 3 ? "" : "sm:border-r-2"}`}
              >
                <div className="flex items-center gap-1.5 font-mono text-[0.65rem] font-bold uppercase tracking-wide text-signal-ink-faint">
                  <span className={`h-2 w-2 ${s.swatch}`} />
                  {s.label}
                </div>
                <div className="mt-1 font-mono text-2xl font-black tabular-nums">{s.value}</div>
              </div>
            ))}
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b-2 border-signal-ink font-mono text-[0.65rem] font-bold uppercase tracking-wide text-signal-ink-faint">
                <th className="py-2">Device</th>
                <th className="py-2">Plan</th>
                <th className="py-2">IP</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-signal-ink-faint/30">
                <td className="py-2.5 font-semibold">Kilimani-RB2011</td>
                <td className="py-2.5">Daily &middot; 5 Mbps</td>
                <td className="py-2.5 font-mono">10.77.4.12</td>
                <td className="py-2.5">
                  <span className="border-2 border-signal-ink bg-signal-brand px-2 py-0.5 text-xs font-bold text-white">
                    ACTIVE
                  </span>
                </td>
              </tr>
              <tr>
                <td className="py-2.5 font-semibold">Ngong-RB750</td>
                <td className="py-2.5">Hourly &middot; 2 Mbps</td>
                <td className="py-2.5 font-mono">10.77.6.03</td>
                <td className="py-2.5">
                  <span className="border-2 border-signal-ink bg-signal-voucher px-2 py-0.5 text-xs font-bold text-black">
                    RENEWING
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="pricing" className="grid border-b-2 border-signal-ink sm:grid-cols-3">
        {TIERS.map((tier, i) => (
          <div
            key={tier.name}
            className={`flex flex-col gap-3 p-8 sm:p-9 ${i < 2 ? "border-b-2 border-signal-ink sm:border-b-0 sm:border-r-2" : ""} ${
              tier.style === "highlight" ? "bg-signal-chrome text-signal-chrome-ink" : ""
            }`}
          >
            <h3 className="text-sm font-black uppercase tracking-wide">{tier.name}</h3>
            <div className="font-mono text-4xl font-black tabular-nums">Ksh —</div>
            <div
              className={`text-xs font-bold ${tier.style === "highlight" ? "text-signal-chrome-ink-dim" : "text-signal-ink-faint"}`}
            >
              placeholder — needs real pricing
            </div>
            <ul className="mt-2 flex flex-col gap-2 text-sm font-medium">
              {tier.features.map((f) => (
                <li key={f}>— {f}</li>
              ))}
            </ul>
            <a
              href="#"
              className={
                tier.style === "highlight"
                  ? "btn-yellow mt-3 border-signal-chrome-ink self-start"
                  : "btn-outline mt-3 border-signal-ink self-start"
              }
            >
              {tier.cta}
            </a>
          </div>
        ))}
      </section>

      <section className="flex flex-col items-start gap-5 border-b-2 border-signal-ink bg-signal-brand px-6 py-16 text-white sm:px-14">
        <h2 className="max-w-2xl text-3xl font-black tracking-tight text-balance sm:text-4xl">
          Link your first router before your coffee gets cold.
        </h2>
        <Link href="#pricing" className="btn-yellow border-white">
          Get started
        </Link>
      </section>

      <footer className="px-6 py-10 sm:px-10">
        <div className="grid gap-8 sm:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5 text-base font-black tracking-tight">
              <span className="relative h-[18px] w-[18px] shrink-0 bg-signal-alert">
                <span className="absolute left-[5px] top-[5px] h-3 w-3 bg-signal-brand" />
              </span>
              ECHO
            </div>
            <p className="mt-2.5 max-w-[32ch] text-sm font-medium text-signal-ink-faint">
              Automated MikroTik hotspot &amp; PPPoE billing for independent ISPs.
            </p>
          </div>
          <div className="flex flex-col gap-2 text-sm font-semibold">
            <div className="mb-1 font-mono text-xs font-black uppercase tracking-wide text-signal-ink-faint">
              Product
            </div>
            <a href="#features">Features</a>
            <a href="#console">Console</a>
            <a href="#pricing">Pricing</a>
          </div>
          <div className="flex flex-col gap-2 text-sm font-semibold">
            <div className="mb-1 font-mono text-xs font-black uppercase tracking-wide text-signal-ink-faint">
              Legal
            </div>
            <a href="#">Privacy policy</a>
            <a href="#">Terms of use</a>
          </div>
          <div className="flex flex-col gap-2 text-sm font-semibold">
            <div className="mb-1 font-mono text-xs font-black uppercase tracking-wide text-signal-ink-faint">
              Contact
            </div>
            <a href="#">Twitter / X</a>
            <a href="#">GitHub</a>
            <a href="#">Email (placeholder)</a>
          </div>
        </div>
        <div className="mt-8 flex items-center justify-between border-t-2 border-signal-ink pt-4 text-xs font-bold text-signal-ink-faint">
          <span>&copy; 2026 Echo. All rights reserved.</span>
          <span>Nairobi, Kenya</span>
        </div>
      </footer>
    </>
  );
}
