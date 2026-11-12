// Dossier d'exemption signé en PDF (PL-205). Même garde que l'API (orgProcedure : tout membre de l'organisation
// active) ; rendu dans src/server/services/exemption-document.tsx (règle 3 de CLAUDE.md).
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { isLocale } from "@/i18n/config";
import { createContext } from "@/server/context";
import { createCaller } from "@/server/routers/_app";
import { renderExemptionDocument } from "@/server/services/exemption-document";
import { slugify } from "@/server/services/system-registry";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang = new URL(request.url).searchParams.get("lang");
  const locale = isLocale(lang) ? lang : "fr";
  try {
    const api = createCaller(await createContext(request.headers));
    const data = await api.exemption.document({ systemId: id });
    const pdf = await renderExemptionDocument(data, locale, new Date());
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="dossier-exemption-${slugify(data.system.name)}-${locale}.pdf"`,
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
