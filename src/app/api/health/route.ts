// Point de santé (PL-108) pour la surveillance de disponibilité : 200 si la base répond, 503 sinon. Sans détail.
import { healthCheck } from "@/server/system/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const health = await healthCheck();
  return Response.json(health, {
    status: health.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
