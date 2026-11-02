import { handle, readJson } from "@/lib/errors";
import { createHoldSchema, parse } from "@/lib/validation";
import { createHold } from "@/services/holds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ event_id: string }> }): Promise<Response> {
  return handle(async () => {
    const { event_id } = await ctx.params;
    const body = parse(createHoldSchema, await readJson(req));
    const hold = await createHold(event_id, body.tier_id, body.quantity);
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
