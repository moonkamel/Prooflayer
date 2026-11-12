// Réception des webhooks Jira (PL-404, §4.5.2) : authentification vérifiée (JWT HS256 signé avec le secret client,
// hypothèse du cahier), insertion idempotente sur `X-Atlassian-Webhook-Identifier`, 202 immédiat ; le traitement
// (relecture du ticket) suit par waitUntil, le cron reprenant les livraisons en attente. Aucune logique ici.
import { waitUntil } from "@vercel/functions";
import { verifyJiraWebhookJwt } from "@/server/connectors/jira/webhook-auth";
import { processDelivery } from "@/server/ingest/process-delivery";
import { recordDelivery } from "@/server/system/webhooks";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function POST(req: Request, { params }: { params: Promise<{ cloudId: string }> }) {
  const secret = process.env.JIRA_CLIENT_SECRET;
  if (!secret) return new Response("webhook non configuré", { status: 503 });
  const { cloudId } = await params;
  if (!UUID.test(cloudId)) return new Response("bad request", { status: 400 });
  if (!verifyJiraWebhookJwt(req.headers.get("authorization"), secret, new Date())) {
    return new Response("invalid signature", { status: 401 });
  }
  const deliveryId = req.headers.get("x-atlassian-webhook-identifier");
  if (!deliveryId) return new Response("bad request", { status: 400 });
  const raw = Buffer.from(await req.arrayBuffer());
  let payload: { webhookEvent?: unknown };
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return new Response("bad request", { status: 400 });
  }
  const id = deliveryId.slice(0, 128);
  const created = await recordDelivery({
    provider: "JIRA",
    deliveryId: id,
    eventType: String(payload.webhookEvent ?? "unknown").slice(0, 64),
    externalAccountId: cloudId,
    payload,
    rawBody: raw,
  });
  if (created) waitUntil(processDelivery("JIRA", id).catch(() => undefined));
  return new Response(null, { status: 202 });
}
