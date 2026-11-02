import { handle, readJson } from "@/lib/errors";
import { parse, webhookSchema } from "@/lib/validation";
import { processWebhook } from "@/services/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 2xx = applied or durably parked. Any non-2xx (incl. 500 on DB errors) asks the processor to retry.
export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const payload = parse(webhookSchema, await readJson(req));
    const result = await processWebhook(payload);
    console.log(
      JSON.stringify({ level: "info", msg: "webhook", event_id: payload.event_id, type: payload.type, ...result }),
    );
    return Response.json({ received: true, ...result }, { status: 200 });
  });
}
