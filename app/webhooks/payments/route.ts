import { readJson } from "@/lib/errors";
import { inc, instrument } from "@/lib/observability";
import { parse, webhookSchema } from "@/lib/validation";
import { processWebhook } from "@/services/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 2xx = applied or durably parked. Any non-2xx (incl. 500 on DB errors) asks the processor to retry.
export async function POST(req: Request): Promise<Response> {
  return instrument("POST /webhooks/payments", req, async ({ requestId }) => {
    const payload = parse(webhookSchema, await readJson(req));
    const result = await processWebhook(payload);
    inc("webhooks_total", { type: payload.type, outcome: result.outcome });
    console.log(
      JSON.stringify({
        level: "info",
        msg: "webhook",
        request_id: requestId,
        event_id: payload.event_id,
        order_id: payload.order_id,
        type: payload.type,
        ...result,
      }),
    );
    return Response.json({ received: true, ...result }, { status: 200 });
  });
}
