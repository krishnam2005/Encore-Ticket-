import { requireAdmin } from "@/lib/admin-auth";
import { AppError } from "@/lib/errors";
import { instrument } from "@/lib/observability";
import { getOrderAudit } from "@/services/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /admin/audit?order_id=ord_123   (Authorization: Bearer $ADMIN_TOKEN)
export async function GET(req: Request): Promise<Response> {
  return instrument("GET /admin/audit", req, async () => {
    requireAdmin(req);
    const orderId = new URL(req.url).searchParams.get("order_id");
    if (!orderId) throw new AppError(400, "VALIDATION_ERROR", "Query parameter order_id is required");
    return Response.json(await getOrderAudit(orderId));
  });
}
