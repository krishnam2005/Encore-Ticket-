/**
 * Frontend configuration (public, build-time). No secrets belong here.
 *
 * NEXT_PUBLIC_API_BASE_URL  Base URL of the API. Empty = same origin (the default: the UI is served by
 *                           the same Next.js app as the API). A different origin needs CORS on that API.
 * NEXT_PUBLIC_EVENT_IDS     Comma-separated event ids to show. The API has no "list events" endpoint,
 *                           so the console has to be told which events exist.
 */
export const API_BASE_URL: string = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");

export const EVENT_IDS: string[] = (process.env.NEXT_PUBLIC_EVENT_IDS ?? "evt_001,evt_002")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

export const HOLD_TTL_MINUTES = 10;
