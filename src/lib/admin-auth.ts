import { timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";

/**
 * /admin/* endpoints expose order history and internals, so they are never public:
 * - ADMIN_TOKEN unset  -> the endpoints behave as if they do not exist (404)
 * - ADMIN_TOKEN set    -> require "Authorization: Bearer <token>" (401 otherwise)
 */
export function requireAdmin(req: Request): void {
  const token = process.env.ADMIN_TOKEN;
  if (!token) throw new AppError(404, "NOT_FOUND", "Not found");

  const header = req.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError(401, "UNAUTHORIZED", "Missing or invalid admin token");
  }
}
