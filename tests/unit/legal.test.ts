// PL-606 — Pages légales, fonctions pures : identité de l'éditeur lue en configuration (jamais inventée), marqueurs
// remplacés, security.txt (RFC 9116), parité des textes et des sous-traitants dans les deux langues.
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import {
  fillLegal,
  LEGAL_DOCUMENTS,
  LEGAL_FIELDS,
  legalEntity,
  securityTxt,
  SUBPROCESSORS,
} from "@/lib/legal";

const complete = {
  LEGAL_COMPANY_NAME: "ProofLayer SAS",
  LEGAL_COMPANY_FORM: "SAS",
  LEGAL_SHARE_CAPITAL: "1 000 €",
  LEGAL_RCS: "RCS Paris 000 000 000",
  LEGAL_VAT_NUMBER: "FR00000000000",
  LEGAL_ADDRESS: "1 rue de l'Exemple, 75000 Paris",
  LEGAL_PUBLICATION_DIRECTOR: "Directeur",
  LEGAL_CONTACT_EMAIL: "contact@example.test",
  LEGAL_COURT: "tribunal de commerce de Paris",
  LEGAL_HOST_ADDRESS: "adresse de l'hébergeur",
};

describe("identité de l'éditeur", () => {
  it("sans configuration : tout manque, rien n'est inventé", () => {
    const entity = legalEntity({});
    expect(entity.missing.sort()).toEqual(Object.keys(LEGAL_FIELDS).sort());
    expect(Object.values(entity.values).every((v) => v === null)).toBe(true);
  });

  it("complète : sécurité et confidentialité reprennent le contact par défaut", () => {
    const entity = legalEntity(complete);
    expect(entity.missing).toEqual([]);
    expect(entity.values.security).toBe("contact@example.test");
    expect(
      legalEntity({ ...complete, LEGAL_SECURITY_EMAIL: "security@example.test" }).values.security,
    ).toBe("security@example.test");
  });

  it("adresse invalide ou vide : absente", () => {
    const entity = legalEntity({
      ...complete,
      LEGAL_CONTACT_EMAIL: "pas une adresse",
      LEGAL_RCS: "  ",
    });
    expect(entity.missing).toEqual(
      expect.arrayContaining(["contact", "security", "privacy", "registration"]),
    );
  });

  it("marqueurs remplacés ; absent → libellé visible ; inconnu laissé tel quel", () => {
    expect(
      fillLegal(
        "{company} au {address} ({autre})",
        { company: "X", address: null },
        "[à compléter]",
      ),
    ).toBe("X au [à compléter] ({autre})");
  });
});

describe("security.txt", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  it("sans contact : aucun fichier", () => {
    expect(securityTxt({ contact: null, origin: "https://app.example.test", now })).toBeNull();
  });
  it("champs RFC 9116 ; expiration à moins d'un an", () => {
    const body = securityTxt({
      contact: "security@example.test",
      origin: "https://app.example.test/",
      now,
    })!;
    expect(body).toContain("Contact: mailto:security@example.test\n");
    expect(body).toContain("Expires: 2027-05-14T00:00:00Z\n");
    expect(body).toContain("Canonical: https://app.example.test/.well-known/security.txt\n");
    expect(body).toContain("Policy: https://app.example.test/trust#disclosure\n");
    expect(body).toContain("Preferred-Languages: fr, en\n");
  });
});

describe("textes", () => {
  const messages = { fr, en } as const;
  const allFields = Object.keys(LEGAL_FIELDS);

  it("chaque document a le même nombre de sections et de paragraphes dans les deux langues", () => {
    for (const doc of LEGAL_DOCUMENTS) {
      const shape = (m: typeof fr) =>
        (m.legal[doc].sections as { paragraphs: string[] }[]).map((s) => s.paragraphs.length);
      expect(shape(en), doc).toEqual(shape(fr));
    }
  });

  it("seuls des marqueurs connus ; mêmes marqueurs dans les deux langues", () => {
    for (const doc of LEGAL_DOCUMENTS) {
      const markers = (m: typeof fr) =>
        [...JSON.stringify(m.legal[doc]).matchAll(/\{(\w+)\}/gu)].map((x) => x[1]!).sort();
      expect(
        markers(fr).every((k) => allFields.includes(k)),
        doc,
      ).toBe(true);
      expect(markers(en), doc).toEqual(markers(fr));
    }
  });

  it("chaque sous-traitant est décrit dans les deux langues", () => {
    for (const { id } of SUBPROCESSORS) {
      for (const m of Object.values(messages)) {
        expect(m.legal.subprocessors.items[id]).toMatchObject({
          role: expect.any(String),
          data: expect.any(String),
          location: expect.any(String),
        });
      }
    }
  });

  it("conditions générales : absence de conseil juridique, disponibilité 99,5 %, réversibilité (§8.3)", () => {
    const terms = JSON.stringify(fr.legal.terms);
    expect(terms).toContain("ne fournit aucun conseil juridique");
    expect(terms).toContain("99,5 %");
    expect(terms).toContain("Réversibilité");
    expect(terms).toContain("douze mois précédant le fait générateur");
  });
});
