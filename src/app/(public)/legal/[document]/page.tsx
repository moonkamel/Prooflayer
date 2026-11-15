// Documents contractuels publics (PL-606, §8.3) : conditions générales, contrat de sous-traitance (Art. 28 RGPD),
// politique de confidentialité, mentions légales. Textes dans messages/{fr,en}.json (`legal.<document>`) ; identité de
// l'éditeur lue en configuration (`legalEntity`), jamais inventée : un champ absent est signalé en tête de page.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/alert";
import { fillLegal, isLegalDocument, LEGAL_VERSION, legalEntity } from "@/lib/legal";
import { SubprocessorTable } from "../../trust/subprocessor-table";

export const dynamic = "force-dynamic";

interface Section {
  title: string;
  paragraphs: string[];
}

type Params = { params: Promise<{ document: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { document } = await params;
  if (!isLegalDocument(document)) return {};
  return { title: (await getTranslations("legal"))(`${document}.title`) };
}

export default async function LegalDocumentPage({ params }: Params) {
  const { document } = await params;
  if (!isLegalDocument(document)) notFound();
  const t = await getTranslations("legal");
  const format = await getFormatter();
  const entity = legalEntity(process.env);
  const fill = (text: string) => fillLegal(text, entity.values, t("placeholder"));
  const sections = t.raw(`${document}.sections`) as Section[];
  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <h1>{t(`${document}.title`)}</h1>
        <p className="text-sm text-muted-foreground">
          {t("version", {
            date: format.dateTime(new Date(`${LEGAL_VERSION}T00:00:00Z`), {
              dateStyle: "long",
              timeZone: "UTC",
            }),
          })}
        </p>
      </header>
      {entity.missing.length > 0 && (
        <Alert>
          {t("incomplete", { fields: entity.missing.map((f) => t(`fields.${f}`)).join(", ") })}
        </Alert>
      )}
      <p>{fill(t.raw(`${document}.intro`) as string)}</p>
      {sections.map((section) => (
        <section key={section.title} className="space-y-2">
          <h2>{section.title}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{fill(paragraph)}</p>
          ))}
        </section>
      ))}
      {document === "dpa" && <SubprocessorTable />}
    </article>
  );
}
