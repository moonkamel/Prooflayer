// Gabarits joints au pack (PL-506) : documentation technique (Art. 11(1), Annexe IV, 9 rubriques) et déclaration UE de
// conformité (Art. 47, Annexe V, 8 mentions), en Markdown pour être repris et complétés par le fournisseur. Fonctions
// pures : préremplissage depuis le registre, contrôles suivis rattachés à chaque rubrique, rubriques non remplies
// signalées. Aucune rubrique n'est jamais déclarée complète (§3.3 E14) ; ProofLayer ne rédige pas la mention de
// l'Annexe V point 4, qui reste au fournisseur (règle 7). Textes : `packTemplates` dans messages/{fr,en}.json.
// Liste des rubriques d'après le règlement (UE) 2024/1689, à faire relire par l'avocat partenaire.
import type { PackControl } from "./contents";

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface TemplateInput {
  locale: "fr" | "en";
  generatedAt: Date;
  organization: { name: string };
  system: {
    id: string;
    name: string;
    intendedPurpose: string;
    description: string | null;
    role: string;
    status: string;
    placedOnMarketAt: Date | null;
    vendorName: string | null;
    models: { name: string; provider?: string; version?: string; isGpai?: boolean }[];
    dataCategories: string[];
    owner: string | null;
    oversightOwner: string | null;
  };
  classification: { signedAt: Date; tier: string; annexIIIPoints: string[] } | null;
  designChanges: { occurredAt: Date; summary: string; isSignificant: boolean | null }[];
  controls: PackControl[];
}

export interface Labels {
  /** Textes `packTemplates.*`. */
  t: Translate;
  /** Valeur brute d'une clé (listes de points à compléter). */
  raw(key: string): unknown;
  /** Libellés traduits des énumérations. */
  role(value: string): string;
  systemStatus(value: string): string;
  tier(value: string): string;
  controlStatus(value: string): string;
}

export type SectionState = "EMPTY" | "PARTIAL";

export interface Templates {
  annexIv: { markdown: string; sections: { number: number; state: SectionState }[] };
  annexV: { markdown: string; items: { number: number; state: SectionState | "FILLED" }[] };
  counts: { annexIvEmpty: number; annexIvPartial: number; annexVToWrite: number };
}

export const ANNEX_IV_PATH = "templates/annex-iv.md";
export const ANNEX_V_PATH = "templates/eu-declaration.md";

/** Contrôles de la bibliothèque suivis pour chaque rubrique de l'Annexe IV. */
export const ANNEX_IV_CONTROLS: Readonly<Record<number, readonly string[]>> = {
  1: ["AIA-13-01"],
  2: ["AIA-10-01", "AIA-10-02", "AIA-10-03", "AIA-14-01", "AIA-15-04", "AIA-15-05", "AIA-15-06"],
  3: ["AIA-12-01", "AIA-12-02", "AIA-14-01"],
  4: [],
  5: ["AIA-09-01", "AIA-09-02", "AIA-09-03", "AIA-09-04"],
  6: ["AIA-11-02", "AIA-17-02"],
  7: [],
  8: ["AIA-47-01"],
  9: ["AIA-72-01", "AIA-72-02", "AIA-73-01"],
};

/** Valeur saisie par l'utilisateur, ramenée à une ligne (un saut de ligne casserait la structure du document). */
const line = (value: string) => value.replace(/\s+/gu, " ").trim();

export function buildTemplates(input: TemplateInput, labels: Labels): Templates {
  const { t } = labels;
  const dateFmt = new Intl.DateTimeFormat(input.locale === "en" ? "en-GB" : "fr-FR", {
    dateStyle: "long",
    timeZone: "UTC",
  });
  const day = (d: Date) => dateFmt.format(d);
  const s = input.system;
  const or = (value: string | null | undefined) =>
    value && value.trim() ? line(value) : t("notProvided");
  const controlsByKey = new Map(input.controls.map((c) => [c.key, c]));

  // ── Annexe IV ────────────────────────────────────────────────────────────────────────────────────────────────────
  const prefill: Record<number, string[]> = {
    1: [
      t("annexIv.fields.name", { value: line(s.name) }),
      t("annexIv.fields.provider", {
        value: s.role === "PROVIDER" ? line(input.organization.name) : or(s.vendorName),
      }),
      t("annexIv.fields.role", { value: labels.role(s.role) }),
      ...(s.role !== "PROVIDER" && s.vendorName
        ? [t("annexIv.fields.vendor", { value: line(s.vendorName) })]
        : []),
      t("annexIv.fields.purpose", { value: or(s.intendedPurpose) }),
      ...(s.description ? [t("annexIv.fields.description", { value: line(s.description) })] : []),
      t("annexIv.fields.status", { value: labels.systemStatus(s.status) }),
      t("annexIv.fields.placedOnMarket", {
        value: s.placedOnMarketAt ? day(s.placedOnMarketAt) : t("notProvided"),
      }),
      ...(input.classification
        ? [
            t("annexIv.fields.classification", {
              date: day(input.classification.signedAt),
              tier: labels.tier(input.classification.tier),
              points: input.classification.annexIIIPoints.join(", ") || t("none"),
            }),
          ]
        : []),
    ],
    2: [
      ...s.models.map((m) =>
        t("annexIv.fields.model", {
          name: line(m.name),
          provider: m.provider ? line(m.provider) : t("notProvided"),
          version: m.version ? ` ${line(m.version)}` : "",
          gpai: m.isGpai ? t("annexIv.fields.gpai") : "",
        }),
      ),
      ...(s.dataCategories.length
        ? [t("annexIv.fields.dataCategories", { value: s.dataCategories.map(line).join(", ") })]
        : []),
    ],
    3: [
      ...(s.oversightOwner
        ? [t("annexIv.fields.oversightOwner", { value: line(s.oversightOwner) })]
        : []),
      ...(s.owner ? [t("annexIv.fields.owner", { value: line(s.owner) })] : []),
    ],
    4: [],
    5: [],
    6: [...input.designChanges]
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
      .map((c) =>
        t("annexIv.fields.change", {
          date: day(c.occurredAt),
          summary: line(c.summary),
          qualification:
            c.isSignificant === null
              ? t("annexIv.fields.unqualified")
              : t(c.isSignificant ? "annexIv.fields.significant" : "annexIv.fields.notSignificant"),
        }),
      ),
    7: [],
    8: [t("annexIv.fields.declaration")],
    9: [],
  };
  const sections = Object.keys(ANNEX_IV_CONTROLS).map((n) => {
    const number = Number(n);
    return { number, state: (prefill[number]!.length ? "PARTIAL" : "EMPTY") as SectionState };
  });
  const title = (n: number) => t(`annexIv.sections.${n}.title`);
  const ivLines: string[] = [
    `# ${t("annexIv.fileTitle", { system: line(s.name) })}`,
    "",
    `> ${t("annexIv.intro", { date: day(input.generatedAt) })}`,
    ">",
    `> ${t("annexIv.legalBasis")}`,
    "",
    `## ${t("annexIv.statusTitle")}`,
    "",
    t("annexIv.statusColumns"),
    "|---|---|---|",
    ...sections.map(
      (x) => `| ${x.number} | ${title(x.number)} | ${t(`annexIv.state.${x.state}`)} |`,
    ),
    "",
    t("annexIv.statusSummary", {
      empty: sections.filter((x) => x.state === "EMPTY").length,
      partial: sections.filter((x) => x.state === "PARTIAL").length,
    }),
  ];
  for (const { number, state } of sections) {
    ivLines.push("", `## ${t("annexIv.sectionTitle", { number, title: title(number) })}`, "");
    if (state === "EMPTY") ivLines.push(t("annexIv.emptyNotice"), "");
    else {
      ivLines.push(`**${t("annexIv.prefilled")}**`, "");
      ivLines.push(...prefill[number]!.map((l) => `- ${l}`), "");
    }
    const tracked = ANNEX_IV_CONTROLS[number]!.map((key) => controlsByKey.get(key)).filter(
      (c): c is PackControl => c !== undefined,
    );
    if (tracked.length) {
      ivLines.push(`**${t("annexIv.tracked")}**`, "");
      for (const c of tracked) {
        const values = { key: c.key, title: c.title[input.locale] };
        ivLines.push(
          `- ${
            c.notApplicable
              ? t("annexIv.notTracked", values)
              : t("annexIv.trackedLine", { ...values, status: labels.controlStatus(c.status) })
          }`,
        );
      }
      ivLines.push("");
    }
    ivLines.push(`**${t("annexIv.todo")}**`, "");
    const todo = labels.raw(`annexIv.sections.${number}.todo`);
    for (const item of Array.isArray(todo) ? todo : []) ivLines.push(`- [ ] ${String(item)}`);
  }

  // ── Annexe V ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const org = line(input.organization.name);
  const items: { number: number; state: SectionState | "FILLED"; body: string[] }[] = [
    {
      number: 1,
      state: "FILLED",
      body: [t("annexV.items.1.value", { system: line(s.name), id: s.id })],
    },
    { number: 2, state: "PARTIAL", body: [t("annexV.items.2.value", { organization: org })] },
    { number: 3, state: "FILLED", body: [t("annexV.items.3.value", { organization: org })] },
    { number: 4, state: "EMPTY", body: [] },
    {
      number: 5,
      state: "EMPTY",
      body: [
        t("annexV.items.5.hint", {
          value: s.dataCategories.length ? s.dataCategories.map(line).join(", ") : t("none"),
        }),
      ],
    },
    { number: 6, state: "EMPTY", body: [] },
    { number: 7, state: "EMPTY", body: [t("annexV.items.7.hint")] },
    { number: 8, state: "EMPTY", body: [] },
  ];
  const toWrite = items.filter((i) => i.state !== "FILLED").length;
  const vLines: string[] = [
    `# ${t("annexV.fileTitle", { system: line(s.name) })}`,
    "",
    `> ${t("annexV.intro", { date: day(input.generatedAt) })}`,
    ">",
    `> ${t("annexV.legalBasis")}`,
  ];
  if (s.role !== "PROVIDER") {
    vLines.push(
      "",
      t("annexV.deployerNotice", { role: labels.role(s.role), vendor: or(s.vendorName) }),
    );
  }
  vLines.push(
    "",
    `## ${t("annexV.statusTitle")}`,
    "",
    t("annexV.statusSummary", { count: toWrite }),
  );
  for (const item of items) {
    vLines.push(
      "",
      `## ${t("annexV.sectionTitle", { number: item.number, title: t(`annexV.items.${item.number}.title`) })}`,
      "",
    );
    vLines.push(...item.body);
    if (item.state !== "FILLED") {
      if (item.body.length) vLines.push("");
      vLines.push(t("annexV.toWrite"));
    }
  }

  return {
    annexIv: { markdown: `${ivLines.join("\n")}\n`, sections },
    annexV: {
      markdown: `${vLines.join("\n")}\n`,
      items: items.map(({ number, state }) => ({ number, state })),
    },
    counts: {
      annexIvEmpty: sections.filter((x) => x.state === "EMPTY").length,
      annexIvPartial: sections.filter((x) => x.state === "PARTIAL").length,
      annexVToWrite: toWrite,
    },
  };
}
