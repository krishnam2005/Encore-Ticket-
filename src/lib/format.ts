/** Minor units (cents) -> "€85.00". */
export function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // dateStyle/timeStyle cannot be combined with timeZoneName, so spell the fields out.
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function newWebhookEventId(): string {
  return `evt_wh_ui_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function newOrderId(): string {
  return `ord_ui_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function formatDateTimeSeconds(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}
