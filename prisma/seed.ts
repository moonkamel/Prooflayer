// PL-102 — Données de démonstration : organisation Talvio, 2 systèmes (§2.2 CU1, §5.3 écran B).
// Talvio est une société fictive (avertissement en tête du cahier des charges).
//
// Idempotent : rejouer le script ne crée aucun doublon (upsert sur des identifiants et clés stables).
// S'exécute sous le rôle de migration (DIRECT_DATABASE_URL), jamais sous le rôle applicatif.
// Ne crée aucune classification : elles sont produites par le moteur et signées par un humain (sprint 2).
//
//   pnpm db:seed
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const connectionString = process.env.DIRECT_DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DIRECT_DATABASE_URL manquant : les données de démonstration passent par le rôle de migration.",
  );
}
if (process.env.NODE_ENV === "production") {
  throw new Error("Refus : les données de démonstration ne se chargent pas en production.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const ORG_ID = "org_demo_talvio";
const USER_ID = "usr_demo_clara";
const MEMBER_ID = "mem_demo_clara_talvio";

async function main(): Promise<void> {
  const user = await prisma.user.upsert({
    where: { id: USER_ID },
    update: {},
    create: {
      id: USER_ID,
      email: "clara.martin@talvio.example",
      name: "Clara Martin",
      emailVerified: true,
      locale: "fr",
    },
  });

  const org = await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: {
      id: ORG_ID,
      name: "Talvio",
      slug: "talvio",
      country: "FR",
      employeeBand: "50-249", // 120 salariés (§2.1, P1)
    },
  });

  await prisma.member.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
    update: {},
    create: { id: MEMBER_ID, organizationId: org.id, userId: user.id, role: "owner" },
  });

  // Données métier de l'organisation : RLS forcé (PL-105), donc app.org_id positionné dans la même transaction.
  const systems = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${org.id}, TRUE)`;
    // Essai de 14 jours, 1 système surveillé (§3.2 E11).
    await tx.subscription.upsert({
      where: { orgId: org.id },
      update: {},
      create: { orgId: org.id, plan: "TRIAL", status: "trialing", monitoredSystemsLimit: 1 },
    });

    // Système 1 : celui du cas d'usage CU1 (§2.2) et de l'écran B (§5.3).
    await tx.aiSystem.upsert({
      where: { orgId_slug: { orgId: org.id, slug: "score-adequation-candidat" } },
      update: {},
      create: {
        orgId: org.id,
        name: "Score d'adéquation candidat",
        slug: "score-adequation-candidat",
        intendedPurpose:
          "Classe les candidatures par adéquation au poste pour les recruteurs de nos clients",
        role: "PROVIDER",
        status: "PRODUCTION",
        placedOnMarketAt: new Date("2025-03-14T00:00:00Z"),
        ownerUserId: user.id,
        models: [
          { name: "gradient boosting", provider: "interne", version: "2.14", isGpai: false },
          { name: "claude-sonnet", provider: "Anthropic", version: null, isGpai: true },
        ],
        dataCategories: ["CV", "offres", "décisions passées des clients"],
        monitored: true,
      },
    });

    // Système 2 : non nommé par le cahier des charges ; brique d'extraction de CV, en développement, non surveillée.
    await tx.aiSystem.upsert({
      where: { orgId_slug: { orgId: org.id, slug: "analyse-de-cv" } },
      update: {},
      create: {
        orgId: org.id,
        name: "Analyse de CV",
        slug: "analyse-de-cv",
        intendedPurpose:
          "Extrait les champs structurés d'un CV (identité, expériences, compétences) pour préremplir la fiche candidat",
        role: "PROVIDER",
        status: "DEVELOPMENT",
        ownerUserId: user.id,
        models: [],
        dataCategories: ["CV"],
        monitored: false,
      },
    });

    return tx.aiSystem.count({ where: { orgId: org.id } });
  });
  console.log(`Données de démonstration chargées : organisation ${org.slug}, ${systems} systèmes.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
