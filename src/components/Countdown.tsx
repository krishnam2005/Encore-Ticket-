"use client";

import { Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { formatCountdown } from "@/lib/format";
import { Badge } from "./ui";

/**
 * Counts down to expires_at using the browser clock. It is a display aid only: the server decides
 * expiry (using its own clock) every time inventory is read.
 */
export function Countdown({ expiresAt, active }: { expiresAt: string; active: boolean }) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;
  const remaining = new Date(expiresAt).getTime() - now;
  if (remaining <= 0) return <Badge tone="warn">Timer elapsed (browser clock)</Badge>;

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-sm tabular-nums text-zinc-700">
      <Timer className="size-4 text-zinc-400" aria-hidden />
      {formatCountdown(remaining)}
    </span>
  );
}
