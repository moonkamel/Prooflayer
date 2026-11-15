// Liste des sous-traitants ultérieurs (§8.2), partagée par le contrat de sous-traitance et le centre de confiance.
import { getTranslations } from "next-intl/server";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import { SUBPROCESSORS } from "@/lib/legal";

export async function SubprocessorTable() {
  const t = await getTranslations("legal.subprocessors");
  return (
    <Table>
      <caption className="text-left font-semibold">{t("caption")}</caption>
      <thead>
        <tr>
          <TableHead scope="col">{t("name")}</TableHead>
          <TableHead scope="col">{t("role")}</TableHead>
          <TableHead scope="col">{t("data")}</TableHead>
          <TableHead scope="col">{t("location")}</TableHead>
        </tr>
      </thead>
      <tbody>
        {SUBPROCESSORS.map((p) => (
          <tr key={p.id}>
            <TableCell>{p.name}</TableCell>
            <TableCell>{t(`items.${p.id}.role`)}</TableCell>
            <TableCell>{t(`items.${p.id}.data`)}</TableCell>
            <TableCell>{t(`items.${p.id}.location`)}</TableCell>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
