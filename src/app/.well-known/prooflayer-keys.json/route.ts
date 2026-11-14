// Clés publiques de signature des packs (PL-504, §3.2 E9 : « publiée à une adresse stable » ; §4.4.3). Publique, sans
// session. Les clés retirées restent listées pour vérifier les anciens packs (§4.6.5). Aucune logique ici.
import { publishedSigningKeys } from "@/server/system/signing-keys";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(
    { keys: await publishedSigningKeys() },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
