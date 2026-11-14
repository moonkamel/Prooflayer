// Écran E (§5.3) : export du pack d'audit (PL-504). Formulaire de période et de langue, aperçu chiffré (les contrôles
// en échec et sans preuve figurent toujours dans le pack : aucune option ne les exclut), packs déjà générés avec leur
// téléchargement, commande de vérification hors ligne.
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/alert";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import { ADMIN_ROLES } from "@/server/services/role-policy";
import { loadSystem } from "../load";
import { CopyCommandButton, PackForm } from "./pack-form";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { system } = await loadSystem((await params).id);
  return { title: `${(await getTranslations("packs"))("title")} · ${system.name}` };
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export default async function SystemPacksPage({ params }: Params) {
  const { api, system } = await loadSystem((await params).id);
  const t = await getTranslations("packs");
  const format = await getFormatter();
  const today = new Date();
  const defaults = { start: dayOf(new Date(today.getTime() - 90 * 86_400_000)), end: dayOf(today) };
  const [org, packs, preview] = await Promise.all([
    api.org.get(),
    api.pack.list({ systemId: system.id }),
    api.pack.preview({ systemId: system.id, periodStart: defaults.start, periodEnd: defaults.end }),
  ]);
  const canCreate = ADMIN_ROLES.includes(org.role);
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="new-pack"
        className="space-y-3 rounded-md border border-border bg-background p-4"
      >
        <h2 id="new-pack">{t("newTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        {canCreate ? (
          <PackForm systemId={system.id} defaults={defaults} initialPreview={preview} />
        ) : (
          <Alert>{t("adminOnly")}</Alert>
        )}
      </section>

      <section aria-labelledby="previous-packs" className="space-y-3">
        <h2 id="previous-packs">{t("previous")}</h2>
        {packs.length === 0 ? (
          <p className="text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table data-testid="packs">
              <thead>
                <tr>
                  <TableHead scope="col">{t("createdAt")}</TableHead>
                  <TableHead scope="col">{t("periodCol")}</TableHead>
                  <TableHead scope="col">{t("evidenceCol")}</TableHead>
                  <TableHead scope="col">{t("signatureCol")}</TableHead>
                  <TableHead scope="col">{t("statusCol")}</TableHead>
                  <TableHead scope="col">{t("actions")}</TableHead>
                </tr>
              </thead>
              <tbody>
                {packs.map((p) => (
                  <tr key={p.id} data-testid="pack" data-status={p.status}>
                    <TableCell>
                      {format.dateTime(new Date(p.createdAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </TableCell>
                    <TableCell>
                      {t("periodRange", { start: day(p.periodStart), end: day(p.periodEnd) })}
                    </TableCell>
                    <TableCell>{p.status === "READY" ? p.evidenceCount : "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.signingKid ? `Ed25519 · ${p.signingKid}` : "—"}
                    </TableCell>
                    <TableCell>{t(`status.${p.status as "READY"}`)}</TableCell>
                    <TableCell>
                      {p.status === "READY" ? (
                        <a href={`/api/packs/${p.id}/download`} download>
                          {t("download")}
                          <span className="sr-only"> · {day(p.createdAt)}</span>
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </section>

      <section
        aria-labelledby="verify-pack"
        className="space-y-2 rounded-md bg-slate-900 p-4 text-slate-100"
      >
        <h2 id="verify-pack" className="text-white">
          {t("verifyTitle")}
        </h2>
        <p className="rounded bg-slate-800 px-3 py-2 font-mono text-sm">{t("verifyCommand")}</p>
        <CopyCommandButton command={t("verifyCommand")} />
      </section>
    </div>
  );
}
