// Pack d'audit public de ProofLayer (PL-606, centre de confiance). Sans session ; aucune logique ici
// (src/server/services/public-pack.ts). Limité par IP comme l'API.
import { publicPackArchive } from "@/server/services/public-pack";
import { consume, ipKey, RATE_RULES, requestIp, tooManyRequests } from "@/server/system/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const decision = await consume(
    `public-pack:${ipKey(requestIp(request.headers))}`,
    RATE_RULES.api,
  );
  if (!decision.allowed) return tooManyRequests(decision);
  const archive = await publicPackArchive();
  if (!archive) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(archive.bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${archive.filename.replace(/[^\w.-]/gu, "")}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
