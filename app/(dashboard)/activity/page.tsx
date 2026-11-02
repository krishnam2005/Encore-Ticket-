"use client";

import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { JsonBlock } from "@/components/JsonBlock";
import { Badge, Button, Card, PageHeader, statusTone } from "@/components/ui";
import type { ActivityEntry } from "@/lib/api-client";
import { useApi } from "@/lib/api-context";
import { formatTime } from "@/lib/format";

type Filter = "all" | "ok" | "failed";

export default function ActivityPage() {
  const { activity, clearActivity } = useApi();
  const [filter, setFilter] = useState<Filter>("all");

  const shown = activity.filter((a) => (filter === "all" ? true : filter === "ok" ? a.ok : !a.ok));

  return (
    <>
      <PageHeader
        title="API activity"
        description="Every request this console has made: method, endpoint, status, and the raw request and response. Newest first."
        actions={
          <Button variant="secondary" onClick={clearActivity} disabled={activity.length === 0} icon={<Trash2 className="size-4" aria-hidden />}>
            Clear
          </Button>
        }
      />

      <div className="mb-3 inline-flex rounded-lg border border-zinc-200 bg-white p-0.5">
        {(["all", "ok", "failed"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={
              "rounded-md px-3 py-1 text-sm capitalize transition-colors " +
              (filter === f ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100")
            }
          >
            {f === "ok" ? "Success" : f}
          </button>
        ))}
      </div>

      <Card className="[&>div]:p-0">
        {shown.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-zinc-500">
            {activity.length === 0 ? "No requests yet." : "No requests match this filter."}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {shown.map((a) => (
              <Row key={a.id} entry={a} />
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-2 text-xs text-zinc-500">
        Kept in memory for this tab (last 200). A 4xx on a webhook is a deliberate rejection by the API, not a UI error.
      </p>
    </>
  );
}

function Row({ entry }: { entry: ActivityEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-zinc-50"
      >
        {open ? <ChevronDown className="size-4 shrink-0 text-zinc-400" aria-hidden /> : <ChevronRight className="size-4 shrink-0 text-zinc-400" aria-hidden />}
        <span className="w-12 shrink-0 font-mono text-xs font-semibold text-zinc-700">{entry.method}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-800">{entry.path}</span>
        <Badge tone={statusTone(entry.status)}>{entry.status === null ? "network error" : entry.status}</Badge>
        <span className="hidden w-14 shrink-0 text-right text-xs tabular-nums text-zinc-500 sm:block">{entry.durationMs} ms</span>
        <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-zinc-500 sm:block">{formatTime(entry.timestamp)}</span>
      </button>
      {open && (
        <div className="space-y-2 bg-zinc-50/60 px-5 pb-4 pt-1">
          {entry.networkError && <p className="text-xs text-red-700">Network error: {entry.networkError}</p>}
          <JsonBlock label="Request payload" value={entry.requestBody} defaultOpen={entry.requestBody !== null} />
          <JsonBlock label="Response payload" value={entry.responseBody} defaultOpen />
        </div>
      )}
    </li>
  );
}
