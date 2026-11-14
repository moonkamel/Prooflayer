// Réception des webhooks Stripe (PL-601, prompt-type du §9.8). Corps brut, signature vérifiée par
// `stripe.webhooks.constructEvent` (STRIPE_WEBHOOK_SECRET ; invalide → 400), insertion idempotente de event.id dans la
// boîte de réception (fournisseur STRIPE ; déjà vu → 200 sans traitement), puis traitement par waitUntil, le cron
// reprenant les livraisons en attente. Seuls le type et l'identifiant de l'objet sont conservés : l'abonnement est relu
// auprès de Stripe, jamais pris dans la charge (ni adresse, ni moyen de paiement en base).
import Stripe from "stripe";
import { waitUntil } from "@vercel/functions";
import { processDelivery } from "@/server/ingest/process-delivery";
import { TRACKED_EVENTS } from "@/server/services/billing-data";
import { recordDelivery } from "@/server/system/webhooks";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("webhook non configuré", { status: 503 });
  const raw = Buffer.from(await req.arrayBuffer());
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(raw, req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return new Response("invalid signature", { status: 400 });
  }
  if (!TRACKED_EVENTS.has(event.type)) return new Response(null, { status: 200 });
  const object = event.data.object as unknown as Record<string, unknown>;
  const created = await recordDelivery({
    provider: "STRIPE",
    deliveryId: event.id.slice(0, 128),
    eventType: event.type.slice(0, 64),
    externalAccountId: event.account ?? "",
    payload: {
      id: event.id,
      type: event.type,
      data: {
        object: {
          id: object.id,
          mode: object.mode ?? null,
          subscription: object.subscription ?? null,
          parent: object.parent ?? null,
        },
      },
    },
    rawBody: raw,
  });
  if (created) waitUntil(processDelivery("STRIPE", event.id.slice(0, 128)).catch(() => undefined));
  return new Response(null, { status: 200 });
}
