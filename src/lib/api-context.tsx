"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { callApi, type ActivityEntry, type ApiResult, type HttpMethod } from "./api-client";
import type { ApiEvent, HoldCreated, WebhookAck, WebhookPayload } from "./api-types";
import { EVENT_IDS } from "./config";

export type EventState =
  | { status: "loading"; event: ApiEvent | null }
  | { status: "ready"; event: ApiEvent }
  | { status: "error"; event: ApiEvent | null; message: string };

/** A hold created from this UI. Held in memory only; the API has no "list holds" endpoint. */
export interface SessionHold extends HoldCreated {
  event_id: string;
  tier_name: string;
  unit_price: number;
  currency: string;
}

/** An order this UI paid via the webhook simulator. The API has no "get order" endpoint. */
export interface SessionOrder {
  order_id: string;
  tier_id: string;
  quantity: number;
  amount_total: number;
  currency: string;
  refunded: number; // sum of refunds the API confirmed as applied
  fullyRefunded: boolean;
}

interface ApiContextValue {
  activity: ActivityEntry[];
  clearActivity: () => void;
  request: <T>(method: HttpMethod, path: string, body?: unknown, headers?: Record<string, string>) => Promise<ApiResult<T>>;

  /** Admin token: held in React state only (never written to storage); lost on reload by design. */
  adminToken: string | null;
  adminAuthNotice: string | null;
  setAdminToken: (token: string | null) => void;
  /** GET to an admin endpoint with the in-memory token. A 401 clears the token. */
  adminRequest: <T>(path: string) => Promise<ApiResult<T>>;

  events: Record<string, EventState>;
  refreshEvents: () => Promise<void>;

  holds: SessionHold[];
  addHold: (h: SessionHold) => void;
  updateHold: (holdId: string, patch: Partial<SessionHold>) => void;

  orders: SessionOrder[];
  recordPaid: (payload: Extract<WebhookPayload, { type: "order.paid" }>, ack: WebhookAck) => void;
  recordRefund: (orderId: string, amount: number, ack: WebhookAck) => void;
}

const ApiContext = createContext<ApiContextValue | null>(null);
const MAX_ACTIVITY = 200;

export function ApiProvider({ children }: { children: ReactNode }) {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [events, setEvents] = useState<Record<string, EventState>>({});
  const [holds, setHolds] = useState<SessionHold[]>([]);
  const [orders, setOrders] = useState<SessionOrder[]>([]);
  const nextId = useRef(1);

  const request = useCallback(async <T,>(method: HttpMethod, path: string, body?: unknown, headers?: Record<string, string>) => {
    const result = await callApi<T>(method, path, body, headers);
    const entry: ActivityEntry = { ...result.entry, id: nextId.current++ };
    setActivity((prev) => [entry, ...prev].slice(0, MAX_ACTIVITY));
    return result;
  }, []);

  const tokenRef = useRef<string | null>(null);
  const [adminToken, setAdminTokenState] = useState<string | null>(null);
  const [adminAuthNotice, setAdminAuthNotice] = useState<string | null>(null);

  const setAdminToken = useCallback((token: string | null) => {
    tokenRef.current = token;
    setAdminTokenState(token);
    if (token !== null) setAdminAuthNotice(null);
  }, []);

  const adminRequest = useCallback(
    async <T,>(path: string) => {
      const token = tokenRef.current;
      const result = await request<T>("GET", path, undefined, token ? { authorization: `Bearer ${token}` } : undefined);
      if (result.entry.status === 401) {
        tokenRef.current = null;
        setAdminTokenState(null);
        setAdminAuthNotice("The server rejected the admin token (401). Enter it again to continue.");
      }
      return result;
    },
    [request],
  );

  const loadEvent = useCallback(
    async (id: string) => {
      setEvents((prev) => ({ ...prev, [id]: { status: "loading", event: prev[id]?.event ?? null } }));
      const res = await request<ApiEvent>("GET", `/events/${encodeURIComponent(id)}`);
      setEvents((prev) => {
        const previous = prev[id]?.event ?? null;
        if (res.data) return { ...prev, [id]: { status: "ready", event: res.data } };
        const message = res.error?.message ?? res.entry.networkError ?? `Request failed (HTTP ${res.entry.status ?? "?"})`;
        return { ...prev, [id]: { status: "error", event: previous, message } };
      });
    },
    [request],
  );

  const refreshEvents = useCallback(async () => {
    await Promise.all(EVENT_IDS.map((id) => loadEvent(id)));
  }, [loadEvent]);

  useEffect(() => {
    void refreshEvents();
  }, [refreshEvents]);

  const addHold = useCallback((h: SessionHold) => setHolds((prev) => [h, ...prev]), []);
  const updateHold = useCallback(
    (holdId: string, patch: Partial<SessionHold>) =>
      setHolds((prev) => prev.map((h) => (h.hold_id === holdId ? { ...h, ...patch } : h))),
    [],
  );

  const recordPaid = useCallback(
    (p: Extract<WebhookPayload, { type: "order.paid" }>, ack: WebhookAck) => {
      // Only remember orders the API actually acknowledged as newly created.
      const created = ack.status === "processed" && ack.outcome.startsWith("paid_");
      if (!created) return;
      setOrders((prev) =>
        prev.some((o) => o.order_id === p.order_id)
          ? prev
          : [
              {
                order_id: p.order_id,
                tier_id: p.tier_id,
                quantity: p.quantity,
                amount_total: p.amount_total,
                currency: p.currency,
                refunded: 0,
                fullyRefunded: false,
              },
              ...prev,
            ],
      );
    },
    [],
  );

  const recordRefund = useCallback((orderId: string, amount: number, ack: WebhookAck) => {
    // Only trust what the API confirmed: "processed" with an applied-refund outcome.
    const applied = ack.status === "processed" && /^(partially_refunded|refunded)(_after_parked)?$/.test(ack.outcome);
    if (!applied) return;
    setOrders((prev) =>
      prev.map((o) =>
        o.order_id === orderId
          ? { ...o, refunded: o.refunded + amount, fullyRefunded: o.refunded + amount >= o.amount_total }
          : o,
      ),
    );
  }, []);

  const value = useMemo<ApiContextValue>(
    () => ({
      activity,
      clearActivity: () => setActivity([]),
      request,
      adminToken,
      adminAuthNotice,
      setAdminToken,
      adminRequest,
      events,
      refreshEvents,
      holds,
      addHold,
      updateHold,
      orders,
      recordPaid,
      recordRefund,
    }),
    [activity, request, adminToken, adminAuthNotice, setAdminToken, adminRequest, events, refreshEvents, holds, addHold, updateHold, orders, recordPaid, recordRefund],
  );

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error("useApi must be used inside <ApiProvider>");
  return ctx;
}
