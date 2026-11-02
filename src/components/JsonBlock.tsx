"use client";

import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useState } from "react";
import { cx } from "./ui";

export function JsonBlock({
  label,
  value,
  defaultOpen = false,
}: {
  label: string;
  value: unknown;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const empty = value === null || value === undefined;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false); // clipboard unavailable (insecure context / denied): leave the UI unchanged
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
      <div className="flex items-center justify-between px-3 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-xs font-medium text-zinc-700 hover:text-zinc-900"
        >
          {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
          {label}
          {empty && <span className="font-normal text-zinc-400">(empty)</span>}
        </button>
        {!empty && (
          <button
            type="button"
            onClick={copy}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-200/60 hover:text-zinc-800"
            aria-label={`Copy ${label}`}
          >
            {copied ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      {open && !empty && (
        <pre className={cx("max-h-80 overflow-auto border-t border-zinc-200 bg-white px-3 py-2.5 font-mono text-xs leading-5 text-zinc-800")}>
          {text}
        </pre>
      )}
    </div>
  );
}

export function CopyText({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label}`}
      className="inline-flex items-center gap-1 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
    >
      {copied ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}
