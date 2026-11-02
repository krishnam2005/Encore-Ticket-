import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------- Card ---------- */

export function Card({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-xl border border-zinc-200 bg-white shadow-xs", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">{description}</p>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------- Button ---------- */

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:outline-indigo-600 disabled:bg-indigo-300",
  secondary: "border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50 focus-visible:outline-zinc-400 disabled:text-zinc-400",
  danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50 focus-visible:outline-red-500 disabled:text-red-300",
  ghost: "text-zinc-600 hover:bg-zinc-100 focus-visible:outline-zinc-400 disabled:text-zinc-300",
};

export function Button({
  variant = "secondary",
  loading = false,
  icon,
  children,
  className,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed",
        BUTTON_STYLES[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/* ---------- Badge ---------- */

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";

const BADGE_STYLES: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  good: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  bad: "bg-red-50 text-red-700 ring-red-200",
  info: "bg-indigo-50 text-indigo-700 ring-indigo-200",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", BADGE_STYLES[tone])}>
      {children}
    </span>
  );
}

/** Tone for an HTTP status code. */
export function statusTone(status: number | null): Tone {
  if (status === null) return "bad";
  if (status >= 200 && status < 300) return "good";
  if (status >= 400 && status < 500) return "warn";
  return "bad";
}

/* ---------- Form controls ---------- */

const CONTROL =
  "h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 " +
  "focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:bg-zinc-50 disabled:text-zinc-400";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-zinc-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(CONTROL, className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(CONTROL, "pr-8", className)}>
      {children}
    </select>
  );
}

/* ---------- Alert ---------- */

const ALERT_STYLES: Record<Tone, { box: string; icon: ReactNode }> = {
  neutral: { box: "border-zinc-200 bg-zinc-50 text-zinc-700", icon: <Info className="size-4" aria-hidden /> },
  info: { box: "border-indigo-200 bg-indigo-50 text-indigo-900", icon: <Info className="size-4" aria-hidden /> },
  good: { box: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: <CheckCircle2 className="size-4" aria-hidden /> },
  warn: { box: "border-amber-200 bg-amber-50 text-amber-900", icon: <AlertTriangle className="size-4" aria-hidden /> },
  bad: { box: "border-red-200 bg-red-50 text-red-900", icon: <AlertCircle className="size-4" aria-hidden /> },
};

export function Alert({ tone = "neutral", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  const s = ALERT_STYLES[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cx("flex gap-3 rounded-lg border p-3 text-sm", s.box)}>
      <span className="mt-0.5 shrink-0">{s.icon}</span>
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cx("text-[13px] leading-5", title && "mt-0.5")}>{children}</div>}
      </div>
    </div>
  );
}

/* ---------- Stat ---------- */

export function StatCard({
  label,
  value,
  hint,
  badge,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  badge?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-zinc-500">{label}</p>
        {badge}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-zinc-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-zinc-100", className)} />;
}
