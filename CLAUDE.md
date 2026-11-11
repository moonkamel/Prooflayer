# ProofLayer — contexte pour Claude Code

## Produit
SaaS de conformité à l'AI Act (règlement UE 2024/1689, modifié par 2026/1744).
Capture des preuves depuis GitHub et Jira, les scelle, exporte un pack vérifiable.
Spécification de référence : docs/cahier-des-charges.md. Ne jamais contredire ce document sans le signaler.

## Stack
Next.js App Router, TypeScript strict, tRPC v11, Zod, Prisma 7+ (adaptateur pg), Postgres (Supabase, Francfort),
Better Auth, Tailwind + shadcn/ui, next-intl (fr, en), Vitest, Playwright.

## Règles non négociables
1. Tout accès aux données métier passe par `forOrg(orgId)`. `prisma` direct est réservé à src/server/system/.
2. `EvidenceItem` est en ajout seul. Aucune mise à jour hors scellement et effacement.
3. Aucune logique métier dans un routeur tRPC ni dans un route handler : elle vit dans src/server/services/.
4. Normaliseurs, évaluateurs et moteur de classification sont des fonctions pures, sans accès réseau ni base.
5. Aucun LLM dans une décision de classification ou d'évaluation.
6. Aucune chaîne visible en dur : tout passe par messages/{fr,en}.json.
7. Le mot « conforme » n'apparaît jamais dans l'interface. On parle de preuve présente, absente, périmée, en échec.
8. Aucun secret, aucun jeton, aucune charge brute dans les journaux ni dans Sentry.

## Méthode
- Tests d'abord pour : classification, règles, cryptographie, isolation, webhooks.
- Une migration par changement de schéma, avec son retour arrière.
- Avant de terminer : `pnpm typecheck && pnpm lint && pnpm test`.
- En cas de doute sur une obligation légale, citer l'article et s'arrêter pour demander.

## Arborescence
src/app/                 routes, pages, route handlers
src/server/services/     logique métier
src/server/connectors/   github/, jira/ : webhooks, rattrapage, normaliseurs
src/server/rules/        bibliothèque de contrôles et évaluateurs
src/server/classify/     moteur de classification et jeux de tests
src/server/seal/         Merkle, lots, ancrage RFC 3161
src/server/system/       jobs, boîte de réception, cron
packages/verify/         outil de vérification open source

## Base de données (conventions établies par PL-102)
- Deux connexions : `DATABASE_URL` (rôle applicatif `prooflayer_app`, pooler en mode transaction, port 6543) pour l'exécution ;
  `DIRECT_DATABASE_URL` (rôle de migration `postgres`, connexion directe, port 5432) pour les migrations et les données de démonstration.
- Chaque dossier de `prisma/migrations/` contient `migration.sql` et son retour arrière `down.sql`. Ne jamais modifier une migration appliquée.
- Le client Prisma est généré dans `src/generated/prisma` (non versionné) : `pnpm db:generate` avant typecheck et build.
- `pnpm db:check` rejoue application, retour arrière et rejeu sur une base jetable (`DB_CHECK_CONFIRM=jetable`).
- Projet Supabase : `prooflayer`, région eu-central-1 (Francfort).
- Tables d'identité (User, Session, Account, Verification, TwoFactor, Organization, Member, Invitation) : gérées par
  Better Auth. Toute évolution passe par `pnpm exec auth generate` puis une fusion manuelle qui garde les ajouts du §4.3.2.

## Authentification et traductions (conventions établies par PL-103)
- Better Auth : configuration dans `src/server/auth.ts`, client dans `src/lib/auth-client.ts`, garde d'accès dans
  `src/server/services/session.ts` (`requireSession()` dans toute page de l'espace connecté `src/app/(app)/`).
- Jamais de jeton de session envoyé au navigateur : les sessions sont désignées par leur identifiant.
- Emails : `src/server/email/`. Transport `outbox` (fichier local) en développement et en test ; le fournisseur réel arrive à PL-108.
- Traductions : next-intl sans préfixe d'URL ; langue = cookie `NEXT_LOCALE`, puis `Accept-Language`, puis `fr`.
  `messages/fr.json` et `messages/en.json` gardent exactement les mêmes clés (test `tests/unit/i18n.test.ts`).
- Tests e2e : `pnpm test:e2e` exige `DATABASE_URL` (rôle applicatif) et `DIRECT_DATABASE_URL`. La limite de débit de
  Better Auth reste active ; chaque parcours présente sa propre IP de test (`withFreshClientIp`).
- Dépendances : pnpm refuse les versions publiées depuis moins de 24 h. Ne pas ajouter d'exception
  `minimumReleaseAgeExclude` ; choisir la version précédente.

## API, organisations et rôles (conventions établies par PL-104)
- tRPC : `src/server/trpc.ts` (`orgProcedure`, `withRole`, `adminProcedure`, `writeProcedure`), routeurs dans
  `src/server/routers/`, logique dans `src/server/services/`. Composants serveur : `serverCaller()` ; interface : `trpc`.
- Toute mutation passe par `withRole(...)` : les rôles sont lus en métadonnées par `tests/integration/rbac.test.ts`,
  qui vérifie FORBIDDEN pour chaque procédure et chaque rôle insuffisant. Une nouvelle procédure est couverte d'office.
- Rôles : owner, admin, contributor, auditor (`src/server/auth-roles.ts`, `src/server/services/role-policy.ts`).
  Seul un owner donne ou retire le rôle owner ; l'organisation garde toujours un owner.
- Espace connecté : sans organisation → `/onboarding` ; owner ou admin sans 2FA → `/setup-two-factor`.
- Retour après connexion : paramètre `?next=` filtré par `safePath()` (chemins internes uniquement).
- `pnpm test:integration` : tests sur base réelle (`DATABASE_URL`, rôle applicatif), lancés dans le job CI `db`.

## Isolation entre organisations (conventions établies par PL-105)
- RLS activé et forcé, politique `tenant_isolation` sur `"orgId" = current_setting('app.org_id', true)`, pour toute
  table portant `orgId` (exception : `Job`, table système). Une nouvelle table avec `orgId` reçoit sa politique dans
  la même migration, sinon `tests/integration/isolation.test.ts` échoue (vérification du catalogue Postgres).
- `prisma` n'est importé que par `src/server/db.ts` et `src/server/system/` (règle ESLint `no-restricted-imports`).
  Données métier : `forOrg(orgId)`, ou `ctx.db` dans une procédure. Tables d'identité : `src/server/system/identity.ts`.
- Une table ajoutée avec `orgId` doit aussi recevoir une donnée de test dans `isolation.test.ts` (test « couverture »).
- Les tests d'intégration tournent sous le rôle applicatif ; la préparation hors organisation et le nettoyage passent
  par `DIRECT_DATABASE_URL`.

## Journal d'audit (conventions établies par PL-106)
- Toute écriture appelle `audit(ctx, action, cible, métadonnées)` (`src/server/services/audit.ts`) après son succès.
  Une nouvelle action s'ajoute à `AUDIT_ACTIONS` et à `auditActions` dans `messages/{fr,en}.json` (test de parité).
- Écritures faites directement auprès de Better Auth (création d'organisation, acceptation d'invitation) :
  journalisées par ses crochets `organizationHooks` dans `src/server/auth.ts`.
- `AuditLog` est en ajout seul : rôle applicatif sans UPDATE ni DELETE, trigger `audit_log_guard` pour le propriétaire.
  Seule la purge d'une organisation (`app.purge_org` positionné dans la transaction) supprime ses entrées.
- Métadonnées : jamais de secret, de jeton ni de charge brute. Export CSV : cellules protégées contre l'injection de formules.

## Sommaire du cahier des charges

Fichier : docs/cahier-des-charges.md. **Pour un ticket, ne relire que les sections qu'il cite.**

- 1. Vision & positionnement
  - 1.1 Pitch (26 mots)
  - 1.2 Les 3 jobs-to-be-done prioritaires
  - 1.3 Ce que ProofLayer n'est pas
  - 1.4 Hypothèse de valeur unique que le MVP doit prouver
  - 1.5 Calage réglementaire (état au 10 novembre 2026)
- 2. Personas & cas d'usage
  - 2.1 Personas
  - 2.2 Cas d'usage bout-en-bout
  - 2.3 Matrice obligation → preuve attendue → outil source
- 3. Périmètre fonctionnel
  - 3.1 Vue d'ensemble des épics
  - 3.2 Épics du MVP
  - 3.3 Épics V1 et V2
- 4. Architecture technique
  - 4.1 Vue d'ensemble
  - 4.2 Choix de stack
  - 4.3 Modèle de données
  - 4.4 Design de l'API
  - 4.5 Stratégie d'intégration
  - 4.6 Modèle de signature cryptographique des preuves
  - 4.7 Sécurité
  - 4.8 Scalabilité
- 5. UX/UI
  - 5.1 Parcours critique : de l'inscription au premier export
  - 5.2 Principes de design
  - 5.3 Les cinq écrans du MVP
- 6. Modèle économique
  - 6.1 Grille tarifaire
  - 6.2 Justification du prix
  - 6.3 Métriques unitaires cibles
  - 6.4 Premier 100 k€ ARR
- 7. Go-to-market
  - 7.1 Client idéal
  - 7.2 Trois canaux d'acquisition
  - 7.3 Partenariats stratégiques
  - 7.4 Contenu & SEO
  - 7.5 Design partners : recruter les 5 premiers
- 8. Conformité de ProofLayer lui-même
  - 8.1 ProofLayer est-il un système d'IA au sens de l'AI Act ?
  - 8.2 RGPD, hébergement, contrat de sous-traitance
  - 8.3 À avoir en place avant le premier client payant
- 9. Roadmap de développement avec Claude Code
  - 9.1 Règles de travail
  - 9.2 Sprint 0 — Validation, avant toute ligne de code (2 semaines)
  - 9.3 Sprint 1 — Socle (semaines 1 et 2)
  - 9.4 Sprint 2 — Registre et classification (semaines 3 et 4)
  - 9.5 Sprint 3 — Connecteur GitHub (semaines 5 et 6)
  - 9.6 Sprint 4 — Moteur de règles, dashboard, Jira (semaines 7 et 8)
  - 9.7 Sprint 5 — Scellement et pack d'audit (semaines 9 et 10)
  - 9.8 Sprint 6 — Facturation, durcissement, ouverture des pilotes (semaines 11 et 12)
  - 9.9 Après le MVP
- 10. Estimation budgétaire
  - 10.1 Coût de Claude Code par sprint
  - 10.2 Infrastructure mensuelle par phase
  - 10.3 Services tiers et frais hors infrastructure
  - 10.4 Total jusqu'à 100 k€ ARR
- 11. Risques & anti-fragilité
  - 11.1 Cinq risques majeurs
  - 11.2 Trois hypothèses à valider avant la première ligne de code
  - 11.3 Scénarios de pivot
- 12. Annexes
  - 12.1 Glossaire
  - 12.2 Mapping de l'Annexe III
  - 12.3 Catalogue des contrôles
  - 12.4 Bibliographie réglementaire
  - 12.5 Vingt questions ouvertes à trancher avec les design partners
