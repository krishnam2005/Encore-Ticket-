import { handle } from "@/lib/errors";
import { cancelHold } from "@/services/holds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The path segment is named :order_id by the assignment; it identifies the hold to expire
// (the id returned by POST /events/:event_id/holds).
export async function POST(_req: Request, ctx: { params: Promise<{ order_id: string }> }): Promise<Response> {
  return handle(async () => {
    const { order_id } = await ctx.params;
    const hold = await cancelHold(order_id);
    return Response.json({ hold_id: hold.id, status: hold.status });
  });
}
