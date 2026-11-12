// Réception des webhooks GitHub (PL-302, §4.5.1) : HMAC sur le corps brut, comparaison en temps constant, insertion
// idempotente, réponse 202 immédiate ; le traitement suit par waitUntil, le cron reprenant les livraisons en attente.
// Écart au code du cahier : pas de `preferredRegion` (déprécié dans Next 16 ; région fixée dans Vercel, PL-108), et
// l'insertion passe par src/server/system/webhooks.ts (règle 1 de CLAUDE.md).
import { createHmac, timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { processDelivery } from "@/server/ingest/process-delivery";
import { recordDelivery } from "@/server/system/webhooks";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return new Response("webhook non configuré", { status: 503 });

  const raw = Buffer.from(await req.arrayBuffer()); // corps brut : requis pour le HMAC
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const deliveryId = req.headers.get("x-github-delivery");
  const eventType = req.headers.get("x-github-event");
  if (!deliveryId || !eventType) return new Response("bad request", { status: 400 });

  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload: { installation?: { id?: unknown } };
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const created = await recordDelivery({
    provider: "GITHUB",
    deliveryId: deliveryId.slice(0, 128),
    eventType: eventType.slice(0, 64),
    externalAccountId: String(payload.installation?.id ?? ""),
    payload,
    rawBody: raw,
  });
  if (created)
    waitUntil(processDelivery("GITHUB", deliveryId.slice(0, 128)).catch(() => undefined));
  return new Response(null, { status: 202 });
}
