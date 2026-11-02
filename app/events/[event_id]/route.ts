import { getPool } from "@/lib/db";
import { handle } from "@/lib/errors";
import { getEventWithAvailability } from "@/services/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ event_id: string }> }): Promise<Response> {
  return handle(async () => {
    const { event_id } = await ctx.params;
    const { event, tiers } = await getEventWithAvailability(getPool(), event_id);
    return Response.json({
      id: event.id,
      title: event.title,
      venue: event.venue,
      starts_at: event.starts_at,
      tiers: tiers.map((t) => ({
        id: t.id,
        name: t.name,
        price: t.price,
        currency: t.currency,
        total_inventory: t.total_inventory,
        available: t.available,
      })),
    });
  });
}
