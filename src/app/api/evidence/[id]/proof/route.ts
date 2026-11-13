// Preuve d'inclusion d'une preuve en JSON (PL-503, écran D : « Télécharger le JSON »). Même garde que l'API
// (`evidence.proof`, tout membre de l'organisation active) ; aucune logique ici (src/server/services/evidence-proof.ts).
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { createContext } from "@/server/context";
import { createCaller } from "@/server/routers/_app";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const api = createCaller(await createContext(request.headers));
    const result = await api.evidence.proof({ evidenceId: id });
    return new Response(`${JSON.stringify(result, null, 2)}\n`, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="preuve-${id.replace(/[^\w-]/gu, "")}.json"`,
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
