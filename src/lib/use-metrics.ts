"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MetricsResponse } from "./admin-types";
import { useApi } from "./api-context";

export type MetricsStatus = "loading" | "refreshing" | "ready" | "error";

export interface MetricsState {
  status: MetricsStatus;
  data: MetricsResponse | null;
  updatedAt: Date | null;
  /** HTTP status and latency of the most recent attempt (used by the monitoring probes). */
  lastHttpStatus: number | null;
  lastDurationMs: number | null;
  error: { kind: "disabled" | "network" | "other"; message: string } | null;
}

const INITIAL: MetricsState = {
  status: "loading",
  data: null,
  updatedAt: null,
  lastHttpStatus: null,
  lastDurationMs: null,
  error: null,
};

/**
 * Loads GET /admin/metrics with the in-memory admin token, optionally polling.
 * A 401 is handled centrally (the token is cleared and the gate asks for it again).
 */
export function useMetrics(pollMs: number | null) {
  const { adminRequest, adminToken } = useApi();
  const [state, setState] = useState<MetricsState>(INITIAL);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState((s) => ({ ...s, status: s.data ? "refreshing" : "loading" }));
    const res = await adminRequest<MetricsResponse>("/admin/metrics");
    inFlight.current = false;

    const http = { lastHttpStatus: res.entry.status, lastDurationMs: res.entry.durationMs };
    if (res.data) {
      setState({ status: "ready", data: res.data, updatedAt: new Date(), error: null, ...http });
      return;
    }
    const status = res.entry.status;
    const error: MetricsState["error"] =
      status === null
        ? { kind: "network", message: res.entry.networkError ?? "The request did not reach the API." }
        : status === 404
          ? { kind: "disabled", message: "The admin API is disabled on this server (ADMIN_TOKEN is not configured)." }
          : { kind: "other", message: res.error?.message ?? `Request failed (HTTP ${status}).` };
    setState((s) => ({ ...s, status: "error", error, ...http }));
  }, [adminRequest]);

  useEffect(() => {
    if (adminToken) void refresh();
  }, [adminToken, refresh]);

  useEffect(() => {
    if (!pollMs || !adminToken) return;
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [pollMs, adminToken, refresh]);

  return { ...state, refresh };
}
