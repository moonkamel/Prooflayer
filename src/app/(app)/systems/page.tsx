// Registre des systèmes d'IA (PL-201, §3.2 E2) : liste, création en 3 champs (admin), export CSV et JSON.
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { ADMIN_ROLES } from "@/server/services/role-policy";
import { requireSession } from "@/server/services/session";
import { CreateSystemForm, ExportRegistryButtons } from "./system-controls";
import { Table, TableCell, TableHead } from "@/components/ui/table";

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("systems"))("title") };
}

export default async function SystemsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const session = await requireSession();
  const includeArchived = (await searchParams).archived === "1";
  const api = await serverCaller();
  const [org, systems] = await Promise.all([api.org.get(), api.system.list({ includeArchived })]);
  const isAdmin = ADMIN_ROLES.includes(org.role);
  const people = isAdmin ? await api.org.members.list() : [];
  const t = await getTranslations("systems");
  const tf = await getTranslations("systemFields");
  const tr = await getTranslations("aiActRole");
  const ts = await getTranslations("systemStatus");
  const tk = await getTranslations("riskTier");

  return (
    <div className="space-y-6">
      <h1>{t("title")}</h1>
      <p>{t("intro")}</p>
      <ExportRegistryButtons />

      {systems.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <Table data-testid="registry">
          <thead>
            <tr>
              <TableHead scope="col">{tf("name")}</TableHead>
              <TableHead scope="col">{t("classification")}</TableHead>
              <TableHead scope="col">{tf("role")}</TableHead>
              <TableHead scope="col">{tf("status")}</TableHead>
              <TableHead scope="col">{tf("ownerUserId")}</TableHead>
            </tr>
          </thead>
          <tbody>
            {systems.map((s) => (
              <tr key={s.id} data-testid="registry-row">
                <TableCell>
                  <Link href={`/systems/${s.id}`}>{s.name}</Link>
                  {s.archivedAt && ` (${t("archived")})`}
                </TableCell>
                <TableCell>
                  {tk(s.riskTier)}
                  {s.annexIIIPoints.length > 0 && ` · ${s.annexIIIPoints.join(", ")}`}
                  {s.classificationStale && ` · ${t("toReview")}`}
                </TableCell>
                <TableCell>{tr(s.role)}</TableCell>
                <TableCell>{ts(s.status)}</TableCell>
                <TableCell>{s.owner?.name ?? ""}</TableCell>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p>
        <Link href={includeArchived ? "/systems" : "/systems?archived=1"}>
          {includeArchived ? t("hideArchived") : t("showArchived")}
        </Link>
      </p>

      {isAdmin && (
        <section aria-labelledby="create-title" className="space-y-3">
          <h2 id="create-title">{t("createTitle")}</h2>
          <CreateSystemForm
            defaultOwner={session.user.id}
            people={people.map((p) => ({ value: p.userId, label: `${p.name} (${p.email})` }))}
          />
        </section>
      )}
    </div>
  );
}
