import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "src/generated/**",
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettier,
  {
    // PL-105 : tout accès aux données métier passe par forOrg(orgId) (règle 1 de CLAUDE.md, §4.3.3).
    // `prisma` n'est importé que par src/server/db.ts et src/server/system/.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/db.ts", "src/server/system/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)db$",
              importNames: ["prisma"],
              message:
                "Utiliser forOrg(orgId) (ctx.db dans une procédure). `prisma` est réservé à src/server/system/.",
            },
          ],
        },
      ],
    },
  },
  {
    // PL-109 : aucune chaîne visible en dur (règle 6 de CLAUDE.md) ; tout texte passe par messages/{fr,en}.json.
    // Seules la ponctuation et les espaces neutres sont tolérés dans le JSX ; les attributs (classes, identifiants
    // techniques) ne sont pas concernés, sauf ceux lus par les technologies d'assistance, vérifiés ci-dessous.
    files: ["src/**/*.tsx"],
    rules: {
      "react/jsx-no-literals": [
        "error",
        { noStrings: true, ignoreProps: true, allowedStrings: [" ", "·", "(", ")", ":", "—", "/"] },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute[name.name=/^(aria-label|aria-description|title|alt|placeholder)$/] > Literal[value=/\\p{L}/u]",
          message: "Texte lu par l'utilisateur : passer par la traduction (messages/{fr,en}.json).",
        },
      ],
    },
  },
];

export default config;
