import type { ReactNode } from "react";

export function EmptyState({ icon, message }: { icon: ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center text-signal-ink-dim">
      <span className="opacity-60">{icon}</span>
      <p className="text-sm">{message}</p>
    </div>
  );
}
