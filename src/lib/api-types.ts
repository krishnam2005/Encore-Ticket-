/** Response shapes of the existing backend (see app/**\/route.ts). */

export interface ApiTier {
  id: string;
  name: string;
  price: number; // minor units
  currency: string;
  total_inventory: number;
  available: number;
}

export interface ApiEvent {
  id: string;
  title: string;
  venue: string;
  starts_at: string;
  tiers: ApiTier[];
}

export interface HoldCreated {
  hold_id: string;
  tier_id: string;
  quantity: number;
  status: "active" | "expired" | "converted";
  expires_at: string;
}

export interface HoldCancelled {
  hold_id: string;
  status: "active" | "expired" | "converted";
}

export interface WebhookAck {
  received: true;
  status: "processed" | "duplicate" | "pending";
  outcome: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export interface PaidPayload {
  event_id: string;
  type: "order.paid";
  order_id: string;
  tier_id: string;
  quantity: number;
  amount_total: number;
  currency: string;
  occurred_at: string;
}

export interface RefundPayload {
  event_id: string;
  type: "order.refunded";
  order_id: string;
  amount_refunded: number;
  currency: string;
  occurred_at: string;
}

export type WebhookPayload = PaidPayload | RefundPayload;

export function isApiErrorBody(v: unknown): v is ApiErrorBody {
  if (typeof v !== "object" || v === null || !("error" in v)) return false;
  const e = (v as { error: unknown }).error;
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}
