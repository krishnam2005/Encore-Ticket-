import { AlertTriangle, Clock, CreditCard, Hourglass, PackageCheck, Undo2, type LucideIcon } from "lucide-react";
import type { TimelineItem, TimelineKind } from "@/lib/audit-timeline";
import { formatDateTimeSeconds } from "@/lib/format";
import { CopyText, JsonBlock } from "../JsonBlock";
import { Badge, cx, type Tone } from "../ui";

interface KindStyle {
  label: string;
  icon: LucideIcon;
  circle: string;
  tone: Tone;
}

// Full class strings so Tailwind can see them.
export const KIND_STYLE: Record<TimelineKind, KindStyle> = {
  hold: { label: "Hold", icon: Clock, circle: "bg-zinc-100 text-zinc-600 ring-zinc-200", tone: "neutral" },
  payment: { label: "Payment", icon: CreditCard, circle: "bg-emerald-50 text-emerald-700 ring-emerald-200", tone: "good" },
  refund: { label: "Refund", icon: Undo2, circle: "bg-violet-50 text-violet-700 ring-violet-200", tone: "info" },
  inventory: { label: "Inventory", icon: PackageCheck, circle: "bg-sky-50 text-sky-700 ring-sky-200", tone: "info" },
  parked: { label: "Parked", icon: Hourglass, circle: "bg-amber-50 text-amber-700 ring-amber-200", tone: "warn" },
  warning: { label: "Warning", icon: AlertTriangle, circle: "bg-red-50 text-red-700 ring-red-200", tone: "bad" },
};

const BADGE_FOR_KIND: Record<TimelineKind, string> = {
  hold: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  payment: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  refund: "bg-violet-50 text-violet-700 ring-violet-200",
  inventory: "bg-sky-50 text-sky-700 ring-sky-200",
  parked: "bg-amber-50 text-amber-800 ring-amber-200",
  warning: "bg-red-50 text-red-700 ring-red-200",
};

export function KindBadge({ kind }: { kind: TimelineKind }) {
  return (
    <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", BADGE_FOR_KIND[kind])}>
      {KIND_STYLE[kind].label}
    </span>
  );
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="relative">
      {items.map((item, i) => {
        const { icon: Icon, circle } = KIND_STYLE[item.kind];
        const last = i === items.length - 1;
        return (
          <li key={item.id} className="relative flex gap-4 pb-7 last:pb-0">
            {!last && <span className="absolute left-[17px] top-9 h-[calc(100%-2.25rem)] w-px bg-zinc-200" aria-hidden />}
            <span className={cx("relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", circle)}>
              <Icon className="size-4" aria-hidden />
            </span>

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="text-sm font-semibold text-zinc-900">{item.title}</p>
                <KindBadge kind={item.kind} />
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                <time dateTime={item.at}>{formatDateTimeSeconds(item.at)}</time>
                {item.eventId && (
                  <span className="inline-flex items-center gap-0.5 font-mono">
                    · {item.eventId}
                    <CopyText text={item.eventId} label="event id" />
                  </span>
                )}
              </p>

              {item.note && <p className="mt-2 text-[13px] leading-5 text-zinc-600">{item.note}</p>}

              {item.chips.length > 0 && (
                <dl className="mt-2.5 flex flex-wrap gap-1.5">
                  {item.chips.map((c) => (
                    <div key={c.label} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-xs">
                      <dt className="text-zinc-500">{c.label}</dt>
                      <dd className="font-medium text-zinc-800">{c.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              <div className="mt-2.5 max-w-xl">
                <JsonBlock label="Raw record" value={item.raw} />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function LegendBadges({ kinds }: { kinds: TimelineKind[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {kinds.map((k) => (
        <KindBadge key={k} kind={k} />
      ))}
    </div>
  );
}

export function OrderStatusBadge({ status }: { status: "paid" | "refunded" | "partially_refunded" }) {
  const tone: Tone = status === "paid" ? "good" : status === "refunded" ? "info" : "warn";
  return <Badge tone={tone}>{status.replace("_", " ")}</Badge>;
}
