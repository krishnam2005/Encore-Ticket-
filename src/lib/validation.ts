import { z } from "zod";
import { AppError } from "./errors";

export const createHoldSchema = z.object({
  tier_id: z.string().min(1),
  quantity: z.number().int().positive().max(1000),
});

const isoTimestamp = z.iso.datetime();

export const webhookSchema = z.discriminatedUnion("type", [
  z.object({
    event_id: z.string().min(1),
    type: z.literal("order.paid"),
    order_id: z.string().min(1),
    tier_id: z.string().min(1),
    quantity: z.number().int().positive(),
    amount_total: z.number().int().nonnegative(),
    currency: z.string().length(3),
    occurred_at: isoTimestamp,
  }),
  z.object({
    event_id: z.string().min(1),
    type: z.literal("order.refunded"),
    order_id: z.string().min(1),
    amount_refunded: z.number().int().positive(),
    currency: z.string().length(3),
    occurred_at: isoTimestamp,
  }),
]);

export type WebhookPayload = z.infer<typeof webhookSchema>;
export type PaidPayload = Extract<WebhookPayload, { type: "order.paid" }>;
export type RefundPayload = Extract<WebhookPayload, { type: "order.refunded" }>;

export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid request", {
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}
