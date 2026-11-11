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
];

export default config;
