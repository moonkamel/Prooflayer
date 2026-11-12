// Dépôt local par jeton signé (PL-405), équivalent de l'adresse signée S3 en développement et en test. Aucune logique ici.
import { acceptLocalUpload } from "@/server/system/local-upload";

export const runtime = "nodejs";

export async function PUT(request: Request): Promise<Response> {
  const status = await acceptLocalUpload(
    new URL(request.url).searchParams.get("t"),
    request.headers.get("content-type"),
    new Uint8Array(await request.arrayBuffer()),
  );
  return new Response(null, { status });
}
