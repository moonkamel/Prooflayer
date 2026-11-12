// Champs de l'Annexe VIII section B (Art. 49(2)) : informations à enregistrer dans la base de données de l'UE pour un
// système exempté au titre de l'Art. 6(3). Fonctions pures ; exports CSV et JSON. Libellés : messages, espace
// `exemption.annexB`. Liste reprise du texte du règlement 2024/1689, à vérifier sur la version consolidée.
import type { SystemStatus } from "@/generated/prisma/enums";
import { toCsv } from "./csv";

/** États membres de l'UE (codes ISO 3166-1 alpha-2), pour le point 9. */
export const EU_MEMBER_STATES = [
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
] as const;

export type AnnexBPoint = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Statut du système au sens du point 8, déduit du cycle de vie de la fiche. */
export type MarketStatus = "notYetPlaced" | "onMarket" | "noLongerOnMarket";

export function marketStatusOf(status: SystemStatus): MarketStatus {
  if (status === "PRODUCTION") return "onMarket";
  if (status === "RETIRED") return "noLongerOnMarket";
  return "notYetPlaced";
}

export interface AnnexBInput {
  providerName: string;
  providerAddress: string;
  providerContact: string;
  submitter: string | null;
  representative: string | null;
  tradeName: string;
  systemReference: string;
  intendedPurpose: string;
  art63Conditions: string[];
  conditionJustification: string;
  profilingJustification: string;
  systemStatus: SystemStatus;
  memberStates: string[];
}

export interface AnnexBField {
  point: AnnexBPoint;
  key: string;
  value: string | string[] | null;
}

export function annexVIIIB(input: AnnexBInput): AnnexBField[] {
  return [
    {
      point: 1,
      key: "provider",
      value: [input.providerName, input.providerAddress, input.providerContact],
    },
    { point: 2, key: "submitter", value: input.submitter },
    { point: 3, key: "representative", value: input.representative },
    { point: 4, key: "tradeName", value: [input.tradeName, input.systemReference] },
    { point: 5, key: "intendedPurpose", value: input.intendedPurpose },
    { point: 6, key: "conditions", value: input.art63Conditions.map((c) => `6(3)(${c})`) },
    {
      point: 7,
      key: "grounds",
      value: [input.conditionJustification, input.profilingJustification],
    },
    { point: 8, key: "status", value: marketStatusOf(input.systemStatus) },
    { point: 9, key: "memberStates", value: input.memberStates },
  ];
}

const flat = (value: AnnexBField["value"]) =>
  value === null ? "" : Array.isArray(value) ? value.join(" | ") : value;

export function annexVIIIBToCsv(fields: readonly AnnexBField[]): string {
  return toCsv(
    ["point", "field", "value"],
    fields.map((f) => [f.point, f.key, flat(f.value)]),
  );
}

export function annexVIIIBToJson(fields: readonly AnnexBField[], exportedAt: Date): string {
  return (
    JSON.stringify(
      {
        annex: "VIII",
        section: "B",
        legalBasis: "Regulation (EU) 2024/1689, Art. 49(2)",
        exportedAt: exportedAt.toISOString(),
        fields,
      },
      null,
      2,
    ) + "\n"
  );
}
