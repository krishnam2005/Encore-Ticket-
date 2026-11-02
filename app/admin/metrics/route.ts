import { requireAdmin } from "@/lib/admin-auth";
import { instrument, metricsSnapshot } from "@/lib/observability";
import { inventoryLocking } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /admin/metrics   (Authorization: Bearer $ADMIN_TOKEN). Per-instance, in-memory counters.
export async function GET(req: Request): Promise<Response> {
  return instrument("GET /admin/metrics", req, async () => {
    requireAdmin(req);
    return Response.json({ inventory_locking: inventoryLocking(), ...metricsSnapshot() });
  });
}
