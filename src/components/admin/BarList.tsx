import type { ReactNode } from "react";
import { cx, type Tone } from "../ui";

const BAR: Record<Tone, string> = {
  neutral: "bg-zinc-400",
  info: "bg-indigo-500",
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
};

export interface BarItem {
  key: string;
  label: ReactNode;
  value: number;
  tone?: Tone;
  hint?: string;
}

/** Horizontal bars scaled to the largest value. Renders nothing for an empty list (callers show an empty state). */
export function BarList({ items }: { items: BarItem[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-zinc-700">{i.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-zinc-900">{i.value.toLocaleString()}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-100">
            <div
              className={cx("h-full rounded-full transition-all", BAR[i.tone ?? "info"])}
              style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }}
            />
          </div>
          {i.hint && <p className="mt-1 text-xs text-zinc-500">{i.hint}</p>}
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-2 py-8 text-center">
      <p className="text-sm font-medium text-zinc-700">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-zinc-500">{children}</p>}
    </div>
  );
}
