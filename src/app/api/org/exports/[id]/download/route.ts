// Téléchargement d'un export complet (PL-607, `org.export.download`, owner). Aucune logique ici
// (src/server/services/org-export.ts) ; le téléchargement est journalisé.
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { createContext } from "@/server/context";
import { createCaller } from "@/server/routers/_app";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const api = createCaller(await createContext(request.headers));
    const { bytes, filename } = await api.org.export.download({ exportId: id });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/gu, "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof TRPCError) {
      return new Response(null, { status: getHTTPStatusCodeFromError(error) });
    }
    throw error;
  }
}
