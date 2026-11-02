import { API_BASE_URL } from "./config";
import { isApiErrorBody, type ApiErrorBody } from "./api-types";

export type HttpMethod = "GET" | "POST";

/** One recorded HTTP exchange. This is what the activity console displays. */
export interface ActivityEntry {
  id: number;
  method: HttpMethod;
  path: string;
  timestamp: string; // ISO
  durationMs: number;
  status: number | null; // null = network failure (no HTTP response)
  ok: boolean;
  requestBody: unknown;
  responseBody: unknown;
  networkError: string | null;
}

export interface ApiResult<T> {
  entry: Omit<ActivityEntry, "id">;
  data: T | null; // set only for 2xx
  error: ApiErrorBody["error"] | null; // set for structured API errors
}

/** Performs the HTTP call. Never throws: network and parse failures are returned in the result. */
export async function callApi<T>(method: HttpMethod, path: string, body?: unknown): Promise<ApiResult<T>> {
  const started = performance.now();
  const timestamp = new Date().toISOString();
  const base = { method, path, timestamp, requestBody: body ?? null };

  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      parsed = text; // non-JSON body (e.g. a platform error page)
    }
    return {
      entry: {
        ...base,
        durationMs: Math.round(performance.now() - started),
        status: res.status,
        ok: res.ok,
        responseBody: parsed,
        networkError: null,
      },
      data: res.ok ? (parsed as T) : null,
      error: isApiErrorBody(parsed) ? parsed.error : null,
    };
  } catch (err) {
    return {
      entry: {
        ...base,
        durationMs: Math.round(performance.now() - started),
        status: null,
        ok: false,
        responseBody: null,
        networkError: err instanceof Error ? err.message : "Network request failed",
      },
      data: null,
      error: null,
    };
  }
}
