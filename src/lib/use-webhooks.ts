"use client";

import { useCallback } from "react";
import { useApi } from "./api-context";
import type { ApiResult } from "./api-client";
import type { PaidPayload, RefundPayload, WebhookAck, WebhookPayload } from "./api-types";
import { newWebhookEventId } from "./format";

const WEBHOOK_PATH = "/webhooks/payments";

export function buildPaid(args: {
  order_id: string;
  tier_id: string;
  quantity: number;
  amount_total: number;
  currency: string;
}): PaidPayload {
  return { event_id: newWebhookEventId(), type: "order.paid", ...args, occurred_at: new Date().toISOString() };
}

export function buildRefund(args: { order_id: string; amount_refunded: number; currency: string }): RefundPayload {
  return { event_id: newWebhookEventId(), type: "order.refunded", ...args, occurred_at: new Date().toISOString() };
}

/**
 * Sends a webhook payload exactly as given (so a duplicate can re-send the identical event_id),
 * records the API's answer in the activity log, and updates the session order ledger only from
 * what the API confirmed.
 */
export function useWebhookSender() {
  const { request, recordPaid, recordRefund, refreshEvents } = useApi();

  return useCallback(
    async (payload: WebhookPayload): Promise<ApiResult<WebhookAck>> => {
      const result = await request<WebhookAck>("POST", WEBHOOK_PATH, payload);
      if (result.data) {
        if (payload.type === "order.paid") recordPaid(payload, result.data);
        else recordRefund(payload.order_id, payload.amount_refunded, result.data);
        await refreshEvents();
      }
      return result;
    },
    [request, recordPaid, recordRefund, refreshEvents],
  );
}
