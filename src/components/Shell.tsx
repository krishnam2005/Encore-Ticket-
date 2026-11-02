"use client";

import { Activity, CalendarDays, LayoutDashboard, Lock, Menu, ScrollText, ShieldCheck, Terminal, Ticket, Webhook, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useApi } from "@/lib/api-context";
import { API_BASE_URL } from "@/lib/config";
import { cx } from "./ui";

const NAV_GROUPS = [
  {
    label: null,
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/events", label: "Events & inventory", icon: CalendarDays },
      { href: "/reserve", label: "Reserve tickets", icon: Ticket },
      { href: "/simulator", label: "Payment simulator", icon: Webhook },
      { href: "/activity", label: "API activity", icon: Terminal },
    ],
  },
  {
    // UI pages live under /ops because /admin/* is owned by the API route handlers.
    label: "Admin",
    items: [
      { href: "/ops", label: "Overview", icon: ShieldCheck },
      { href: "/ops/audit", label: "Order audit", icon: ScrollText },
      { href: "/ops/monitoring", label: "System monitoring", icon: Activity },
    ],
  },
] as const;

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { activity } = useApi();
  // "/" and "/ops" are section roots: they must not light up on their children.
  const isActive = (href: string): boolean =>
    pathname === href || (href !== "/" && href !== "/ops" && pathname.startsWith(`${href}/`));

  return (
    <nav className="flex flex-col gap-5 px-3" aria-label="Main">
      {NAV_GROUPS.map((group) => (
        <div key={group.label ?? "main"}>
          {group.label && (
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{group.label}</p>
          )}
          <div className="flex flex-col gap-0.5">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                    active ? "bg-zinc-100 font-medium text-zinc-900" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
                  )}
                >
                  <Icon className={cx("size-4", active ? "text-indigo-600" : "text-zinc-400")} aria-hidden />
                  <span className="flex-1">{label}</span>
                  {href === "/activity" && activity.length > 0 && (
                    <span className="rounded-full bg-zinc-200 px-1.5 text-[11px] tabular-nums text-zinc-700">{activity.length}</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function AdminSessionIndicator() {
  const { adminToken } = useApi();
  return (
    <p className="mb-3 flex items-center gap-1.5">
      {adminToken ? (
        <>
          <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
          <span className="font-medium text-emerald-700">Admin session active</span>
        </>
      ) : (
        <>
          <Lock className="size-3 text-zinc-400" aria-hidden />
          <span>Admin locked</span>
        </>
      )}
    </p>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-6 py-5">
      <div className="flex size-7 items-center justify-center rounded-lg bg-indigo-600 text-white">
        <Ticket className="size-4" aria-hidden />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-zinc-900">Encore Tickets</p>
        <p className="text-[11px] text-zinc-500">Inventory console</p>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen md:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-zinc-200 bg-white md:flex">
        <Brand />
        <NavList />
        <div className="mt-auto border-t border-zinc-100 p-4 text-[11px] leading-4 text-zinc-500">
          <AdminSessionIndicator />
          <p className="font-medium text-zinc-600">API base</p>
          <p className="mt-0.5 break-all font-mono">{API_BASE_URL === "" ? "same origin (/)" : API_BASE_URL}</p>
        </div>
      </aside>

      {/* Mobile top bar + drawer */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur md:hidden">
        <span className="text-sm font-semibold">Encore Tickets</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          className="rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100"
        >
          <Menu className="size-5" aria-hidden />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-30 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" className="absolute inset-0 bg-zinc-900/30" onClick={() => setOpen(false)} aria-label="Close navigation" />
          <div className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <NavList onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">{children}</main>
    </div>
  );
}
