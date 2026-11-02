/** Response shapes of the existing admin endpoints (app/admin/**\/route.ts, src/services/audit.ts). */

export interface MetricsResponse {
  inventory_locking: "tier-lock" | "serializable";
  started_at: string;
  scope: string;
  counters: Record<string, number>;
}

export interface AuditStateChange {
  at: string;
  action: string;
  event_id: string | null;
  detail: Record<string, unknown>;
}

export interface AuditOrder {
  id: string;
  tier_id: string;
  quantity: number;
  status: "paid" | "refunded" | "partially_refunded";
  amount_total: number;
  amount_refunded: number;
  currency: string;
  hold_id: string | null;
  needs_manual_refund: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuditHold {
  id: string;
  tier_id: string;
  quantity: number;
  status: "active" | "expired" | "converted";
  created_at: string;
  expires_at: string;
}

export interface AuditDelivery {
  event_id: string;
  event_type: string;
  occurred_at: string;
  received_at: string;
  processed_at: string | null;
  outcome: string | null;
  payload: unknown;
}

export interface AuditResponse {
  order_id: string;
  order: AuditOrder | null;
  hold: AuditHold | null;
  state_changes: AuditStateChange[];
  webhook_deliveries: AuditDelivery[];
}
