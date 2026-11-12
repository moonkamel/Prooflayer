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

## File de jobs (conventions établies par PL-107)
- `src/server/system/jobs/` : `defineJob({ type, schema, handle })`, enregistré dans `handlers.ts` (`jobRegistry`),
  puis `enqueue(job, payload, { runAt, dedupeKey, orgId, runNow })`. Drainage : `/api/cron/drain` chaque minute
  (`vercel.json`, `CRON_SECRET`) ; `runNow` exécute aussitôt par `waitUntil`, le cron restant le filet de sécurité.
- Toute écriture en base d'un gestionnaire passe par `ctx.tx` : elle est validée avec le passage du job à DONE, ou
  annulée. Si le job porte un `orgId`, `app.org_id` est positionné dans `ctx.tx` (RLS).
- Les effets hors base (réseau, email) doivent être idempotents : une tentative interrompue est rejouée.
- Bail de 5 min (`LEASE_MS`) : aucune tentative ne doit durer plus longtemps (`timeoutMs`, 60 s par défaut).

## Interface (conventions établies par PL-109)
- Tailwind v4 (jetons dans `src/app/globals.css`, contrastes AA), composants shadcn/ui dans `src/components/ui/`
  (Button, Input, Select, Label, Table, Alert, Card), utilitaire `cn` (`src/lib/utils.ts`).
- Coques : `src/app/(app)/layout.tsx` (espace connecté : navigation, organisation active, langue) et
  `src/app/(auth)/layout.tsx` (écrans hors session). La coque porte l'unique `<main id="contenu">` ; une page n'en déclare pas.
- Statuts de contrôle : `<StatusBadge status=… />` uniquement (icône + libellé + couleur, contraste vérifié par test).
- Règle ESLint `react/jsx-no-literals` : aucun texte en dur dans le JSX, ni dans `aria-label`, `title`, `alt`, `placeholder`.
- Chaque page exporte `generateMetadata` avec un titre traduit (gabarit « %s · ProofLayer »).
- Liens soulignés par défaut ; erreurs en `<Alert tone="error">` (role="alert"), informations en `<Alert>` (role="status").
- Accessibilité : tout nouvel écran passe `expectNoViolations` (`tests/e2e/helpers/a11y.ts`, axe, WCAG 2.2 AA), dans
  `tests/e2e/a11y.spec.ts` quand une adresse suffit, sinon dans le parcours qui amène l'écran dans l'état voulu.

## Registre des systèmes d'IA (conventions établies par PL-201)
- Routeur `system` (`src/server/routers/system.ts`), logique dans `src/server/services/systems.ts`, fonctions pures
  (diff, champs de classification, slug, export) dans `src/server/services/system-registry.ts`.
- Historique d'une fiche = journal d'audit (`targetType` `ai_system`, métadonnées `changes: [{ field, before, after }]`).
  Un champ inchangé n'est pas historisé ; écriture conditionnée à `updatedAt` (CONFLICT `system.conflict`).
- `CLASSIFICATION_FIELDS` : finalité prévue, rôle, fournisseur tiers, modèles, catégories de données. Leur modification
  passe `classificationStale` à vrai si une classification signée est en vigueur (un brouillon seul n'a rien à revoir).
- Fiche archivée : lecture et export seulement ; elle sort de la surveillance.
- Modifications de conception : saisie manuelle (`designChanges.create`) en attendant les releases GitHub ; qualification
  significative ou non avec motif obligatoire (`qualifiedAt`, `qualificationReason`), requalification journalisée.
- Écrans : `/systems` (registre) et `/systems/[id]` (écran B : Vue, Changements, Historique). Un onglet ajouté plus tard
  (Contrôles, Preuves, Sources, Packs) se déclare dans `src/app/(app)/systems/[id]/layout.tsx`.

## Moteur de classification (conventions établies par PL-202)
- `src/server/classify/` : `answers.ts` (schéma Zod des réponses), `engine.ts` (`classify(answers, ruleset)`, fonction
  pure, version `CURRENT_RULESET`), `cases.ts` (cas nommés et résultats attendus, relus par l'avocat partenaire).
- Ordre des règles R1 à R9 et rôle (Art. 3(3), 25(1)(a) à (c), sinon déployeur) : prompt-type de PL-202 au §9.4.
  Chaque règle évaluée est tracée (`ruleId`, `answerKey`, `articleRef`, `outcome`, « CONTINUE » si elle ne conclut pas).
- Toute évolution des règles crée une nouvelle version : l'ancienne reste disponible pour les classifications signées.
  Un cas ajouté ou corrigé se fait d'abord dans `cases.ts`.
- `pnpm test:classify` (job CI `checks`) exige 100 % de couverture des branches de `src/server/classify/`.

## Questionnaire de classification (conventions établies par PL-203)
- `src/server/classify/questionnaire.ts` (pur) : 10 questions, 9 au plus sur un chemin ; branchements dans l'ordre des
  règles R1 à R9 (dès qu'une règle conclurait, on passe au rôle) ; `toAnswers` donne la valeur neutre aux questions
  hors chemin. Test croisé : chaque cas de `cases.ts` donne le même résultat par le questionnaire.
- Textes : `messages/{fr,en}.json`, `questionnaire.questions.<id>` (`title`, `why`, `example1`, `example2`, `options`).
- Routeur `classification` (`src/server/services/classification.ts`) : `draft` (un brouillon DRAFT par système, créé
  ou repris ; une requalification reprend les réponses de la version signée), `saveAnswers` (une question, réponse
  journalisée, résultat effacé, réponses déjà données conservées), `compute` (questionnaire complet, version de
  règles du brouillon, seules les réponses du chemin sont gardées). `Classification.answers = { responses }`.
- Écran : `/systems/[id]/classification`, en lecture seule à l'affichage : le brouillon naît d'une action explicite
  (`StartClassificationButton` : « Qualifier ce système », « Revoir la classification », « Requalifier le système »).

## Résultat, signature et note (conventions établies par PL-204)
- Écran A : `src/app/(app)/systems/[id]/classification/result.tsx` ; trace et implications pures dans
  `src/server/classify/explain.ts` (dates du §1.5 : Annexe III 2 décembre 2027, Annexe I 2 août 2028, Art. 50
  2 août 2026, Art. 5 2 février 2025).
- Signature (`classification.sign`) : nom, fonction, déclaration (`classificationResult.statement`, langue du signataire),
  mot de passe vérifié par Better Auth (`passwordVerifier`, injectable), 5 refus au plus par quart d'heure et par
  utilisateur (`classification.signRefused` au journal, puis TOO_MANY_REQUESTS). Pratique interdite : jamais signée.
  Dans `withOrgTransaction` (src/server/db.ts) : l'ancienne version passe à SUPERSEDED, la fiche reprend catégorie,
  points et rôle, `classificationStale` repasse à faux ; un changement de rôle est historisé sur la fiche.
- Immuabilité en base : trigger `classification_guard` (seul passage SIGNED → SUPERSEDED autorisé ; suppression
  d'une version signée seulement sous `app.purge_org`).
- Note PDF : `@react-pdf/renderer`, `src/server/services/classification-note.tsx`, route
  `/api/systems/[id]/classifications/[cid]/note?lang=fr|en`. Textes : `classificationResult.note`.

## Bibliothèque de contrôles (conventions établies par PL-206)
- `src/server/rules/library/` : `schema.ts` (Zod), un fichier par pack (`pack-a.ts`, `pack-b.ts`, `pack-c.ts`),
  `index.ts` (`LIBRARY_VERSION`, `CONTROL_LIBRARY`, `applicableControls(tier, role)`). 37 contrôles MVP du §12.3, dont
  19 automatisés ; textes fr et en dans le fichier du pack. Pack A : tous les rôles et toutes les catégories signables ;
  packs B et C : fournisseur à haut risque.
- `src/server/rules/evaluator-keys.ts` : toute `evaluatorKey` y est déclarée avec le ticket qui livre l'évaluateur.
- Types de preuves : liste `EVIDENCE_KINDS` de `schema.ts` (GitHub et Jira du cahier des charges ; `manual.*` et
  `system.*` introduits ici). Durées de fraîcheur et seuils : seulement ceux que le §12.3 énonce.
- Publication : `pnpm controls:sync` (rôle de migration, idempotent, à chaque déploiement). `ControlDefinition` est en
  lecture seule pour le rôle applicatif. Un contrôle retiré est marqué `deprecatedAt`, jamais supprimé.
- Toute évolution du référentiel publie une nouvelle `LIBRARY_VERSION`.

## Contrôles d'un système (conventions établies par PL-207)
- Plan pur dans `src/server/rules/instantiate.ts` (`planInstances`) ; application dans
  `src/server/services/controls.ts` (`instantiateControls`), appelée dans la transaction de signature.
- Les définitions applicables viennent de `ControlDefinition` (version `LIBRARY_VERSION` publiée) : sans bibliothèque
  publiée, la signature échoue (`controls.libraryNotPublished`). Les tests d'intégration et e2e la publient d'abord
  (`tests/publish-control-library.ts`, déclaré en `globalSetup`).
- Reclassification : les contrôles manquants sont créés ; ceux qui ne s'appliquent plus passent `notApplicable` avec
  la justification `auto:reclassification` (statut NOT_APPLICABLE) et sont rouverts s'ils s'appliquent de nouveau.
  Rien n'est supprimé ; une non-applicabilité posée par un administrateur n'est jamais levée automatiquement.
- Routeur `control` : `listBySystem` (lecture, tout membre). Écran : `/systems/[id]/controls`.

## Dossier d'exemption (conventions établies par PL-205)
- Table `ExemptionDossier` (un dossier par classification signée exemptée, `classificationId` unique), RLS, trigger
  `exemption_dossier_guard` (immuable une fois signé). Service `src/server/services/exemption.ts`, routeur `exemption`
  (`get`, `save`, `sign`, `document`, `annexViii`). Écran `/systems/[id]/exemption` (onglet visible si exempté).
- Signature : même confirmation que la classification ; essais limités partagés (`src/server/services/sign-guard.ts`).
- Champs de l'Annexe VIII section B : `src/server/services/annex-viii.ts` (pur, 9 points, exports CSV et JSON).
- Évaluations : `recordEvaluation` (`src/server/services/controls.ts`) écrit `ControlEvaluation` et le statut de
  l'instance. Évaluateurs purs dans `src/server/rules/evaluators/` (`Evaluation` de `src/server/rules/evaluation.ts`).
  AIA-06-02 (`internal.exemptionDossier`) est évalué à chaque signature de classification ou de dossier.

## Classifieur public (conventions établies par PL-208)
- `/classifier` (groupe `src/app/(public)/`, sans session) : questionnaire et moteur exécutés dans le navigateur (mêmes
  fonctions pures). Lien partageable `?r=` : `src/server/classify/share.ts` (base64url, réponses validées et élaguées).
- Note PDF : `POST /api/public/classifier/note` → `requestNote` (`src/server/services/public-classifier.ts`) : adresse
  professionnelle (`professional-email.ts`), résultat recalculé côté serveur, limites de 3 demandes par adresse et par
  jour et 10 par IP et par heure (IP en HMAC), consentement à être recontacté explicite et facultatif. Envoi par le
  job `publicClassifier.sendNote` (pièce jointe PDF, idempotent par `noteSentAt`).
- Table système `PublicLead` (sans organisation ni RLS), accessible seulement par `src/server/system/public-leads.ts`.
- Transport d'email : `attachments` (base64) dans `EmailMessage`.

## Magasin de preuves (conventions établies par PL-304)
- `src/server/seal/` (pur) : `jcs.ts` (RFC 8785), `merkle.ts` (RFC 6962, code du §4.6.2), `evidence.ts` (contentSha256,
  enveloppe { v, org, id, kind, sourceRef, occurredAt, capturedAt, contentSha256, attachmentSha256 }, leafHash).
  Encodage de l'enveloppe : empreintes en hexadécimal minuscule, dates ISO 8601 UTC à la milliseconde.
- `createEvidence(tx, orgId, input)` (`src/server/services/evidence.ts`) : dans une transaction où app.org_id est
  positionné (job, `withOrgTransaction`) ; doublon (orgId, dedupeKey) ignoré sans erreur ; identifiant `ev_…` tiré
  avant l'insertion (il entre dans l'enveloppe). Charge brute (`raw`) chiffrée AES-256-GCM par la clé de données de
  l'organisation (`OrgEncryptionKey`, enveloppée par `PROOFLAYER_MASTER_KEY`), écrite en stockage objet
  (`orgs/{orgId}/raw/{id}.bin`), jamais en base ni dans les journaux.
- Trigger `evidence_guard` (§4.3.3) : champs scellés immuables, scellement une seule fois, charge seulement mise à
  NULL (effacement), suppression seulement sous `app.purge_org`. Les nettoyages de tests passent par la purge.
- Stockage objet : `src/server/storage/object-store.ts` (`local` en développement et test ; S3 Supabase à PL-108).

## Étanchéité par procédure (convention établie par l'audit du sprint 2)
- `tests/integration/cross-org.test.ts` (§4.7) : chaque procédure tRPC y est classée, soit avec une entrée désignant
  une ressource d'une autre organisation (refus attendu), soit comme portée par l'organisation active. Une procédure
  ajoutée sans y figurer fait échouer le test « inventaire ».
- Lien vers le règlement : `regulationUrl` (`src/lib/regulation.ts`), seul endroit où l'adresse EUR-Lex est écrite.

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
