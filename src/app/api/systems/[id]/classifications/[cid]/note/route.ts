// Note de classification en PDF (PL-204). Même garde que l'API (orgProcedure : tout membre de l'organisation
// active) ; rendu dans src/server/services/classification-note.tsx (règle 3 de CLAUDE.md).
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { isLocale } from "@/i18n/config";
import { createContext } from "@/server/context";
import { createCaller } from "@/server/routers/_app";
import { slugify } from "@/server/services/system-registry";
import { renderClassificationNote } from "@/server/services/classification-note";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; cid: string }> },
) {
  const { id, cid } = await params;
  const lang = new URL(request.url).searchParams.get("lang");
  const locale = isLocale(lang) ? lang : "fr";
  try {
    const api = createCaller(await createContext(request.headers));
    const data = await api.classification.note({ systemId: id, classificationId: cid });
    const pdf = await renderClassificationNote(data, locale, new Date());
    const slug = slugify(data.system.name);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="note-classification-${slug}-${locale}.pdf"`,
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
