#!/bin/sh
# Build sur Vercel (PL-108). Le client Prisma est généré à chaque build (src/generated n'est pas versionné).
# En production seulement, et si la connexion de migration est fournie : migrations puis publication de la
# bibliothèque de contrôles (`pnpm controls:sync`, idempotent, à chaque déploiement : convention PL-206).
# Les prévisualisations ne touchent jamais au schéma.
set -eu
pnpm exec prisma generate
if [ "${VERCEL_ENV:-}" = "production" ] && [ -n "${DIRECT_DATABASE_URL:-}" ]; then
  pnpm exec prisma migrate deploy
  pnpm controls:sync
fi
pnpm exec next build
