import { readJson } from "@/lib/errors";
import { inc, instrument } from "@/lib/observability";
import { enforceRateLimit, holdsRateLimitPerMinute } from "@/lib/rate-limit";
import { createHoldSchema, parse } from "@/lib/validation";
import { createHold } from "@/services/holds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ event_id: string }> }): Promise<Response> {
  return instrument("POST /events/:event_id/holds", req, async () => {
    // Before any DB work: hold-hoarding is the abuse vector for this endpoint.
    enforceRateLimit(req, "holds", holdsRateLimitPerMinute());

    const { event_id } = await ctx.params;
    const body = parse(createHoldSchema, await readJson(req));
    const hold = await createHold(event_id, body.tier_id, body.quantity);
    inc("holds_created_total", { tier_id: hold.tier_id });
    return Response.json(
      {
        hold_id: hold.id,
        tier_id: hold.tier_id,
        quantity: hold.quantity,
        status: hold.status,
        expires_at: hold.expires_at,
      },
      { status: 201 },
    );
  });
}
