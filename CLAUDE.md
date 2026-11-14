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

## Normaliseurs GitHub (conventions établies par PL-305)
- `src/server/connectors/github/normalizers/` : un fichier par type de preuve, fonction pure
  `(charge, { orgId, resourceId, capturedVia, warn }) → GitHubEvidence[]`, entrée validée par Zod, liste blanche
  stricte (ni corps, ni diff, ni commentaire, ni email, ni contenu de fichier, ni valeur de secret).
- Charge invalide : `[]` et un avertissement qui ne contient que le type et le chemin fautif, jamais la charge.
- Clés de déduplication fondées sur les identifiants numériques GitHub (un renommage de dépôt ne les casse pas) ;
  instantanés : une preuve par jour et par état (`…:{AAAA-MM-JJ}:{empreinte de l'état}`).
- PR fusionnées : webhook et rattrapage GraphQL (`pullRequestFromGraphQL`) donnent la même preuve.
- Fixtures : `tests/fixtures/github/<événement>/` (3 par type, anonymisées, champs sensibles présents à dessein).

## Webhooks (conventions établies par PL-302)
- Route `src/app/api/webhooks/github/route.ts` (code du §4.5.1) : HMAC SHA-256 sur le corps brut, temps constant, 503
  sans `GITHUB_WEBHOOK_SECRET`, 202 immédiat, traitement par `waitUntil(processDelivery)`.
- Boîte de réception `WebhookDelivery` (table système) : `src/server/system/webhooks.ts` (enregistrement idempotent,
  prise par `FOR UPDATE SKIP LOCKED`, bail de 5 min, 8 tentatives avec attente exponentielle, message sans charge).
- Traitement `src/server/ingest/process-delivery.ts` : installation → organisation par la fonction SQL
  `resolve_integration` (SECURITY DEFINER, seule lecture d'`Integration` hors RLS), dépôt → `IntegrationResource`
  (`github_repo`, identifiant numérique), normaliseur, `createEvidence` avec la charge brute, livraison PROCESSED dans
  la même transaction. Dépôt non lié, installation inconnue ou événement non suivi : IGNORED.
- Reprise : `/api/cron/drain` traite d'abord les livraisons en attente (`drainDeliveries`), puis la file de jobs.

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

## Moteur d'évaluation (conventions établies par PL-401)
- `src/server/rules/engine.ts` (pur) : `evaluate(definition, evidence[], now, registry)` retient les preuves des types
  acceptés puis appelle l'évaluateur ; `null` si l'évaluateur n'est pas livré. Aides : `reason`, `isStale`
  (fraîcheur ou `validUntil`), `newestFirst`, `windowStart`.
- Registre `src/server/rules/evaluators/index.ts` (`EVALUATORS`) : clé → `{ version, evaluate }`. Un évaluateur livré y
  entre avec son ticket ; sa version (`clé@n`) est historisée avec chaque évaluation.
- `src/server/services/evaluation.ts` : `scheduleEvaluations` (preuves nouvelles → contrôles qui acceptent leur type, sur
  les systèmes liés à leur ressource ou rattachés par `EvidenceLink`), `evaluateInstance` (historise `ControlEvaluation`,
  statut de l'instance, liens `EvidenceLink` « rule » vers les preuves retenues), `scheduleOrgSweep`.
- Jobs `control.evaluate` (clé `control.evaluate:{instanceId}`) et `control.sweepOrg` (`src/server/system/jobs/
  control-evaluate.ts`). `enqueueInTransaction` : programmé dans la transaction des preuves ; dédupliqué tant qu'il
  attend, réarmé sinon (une tentative en cours perd son jeton et s'annule).
- Toute création de preuve appelle `scheduleEvaluations` dans sa transaction ; le webhook exécute aussitôt les jobs après
  validation, le cron de chaque minute reste le filet. Signature d'une classification : contrôles du système programmés.
- Passage quotidien : `/api/cron/daily` (vercel.json) → `scheduleDailySweep` (un `control.sweepOrg` par organisation et
  par jour). Instance non applicable ou système archivé : jamais évalué.

## Évaluateurs GitHub et internes (conventions établies par PL-402)
- Un fichier par famille dans `src/server/rules/evaluators/` (`github-peer-review`, `github-branch-protection`,
  `github-releases`, `github-security`, `github-change-management`, `internal`), aides dans `common.ts` (`parsed`,
  `latestBy`, `staleness`, `detailed` : 20 raisons au plus puis le décompte). Charges relues par Zod ; invalide = ignorée.
- Instantanés : seul le dernier par dépôt (ou par chemin) compte. Péremption commune : la preuve la plus récente au-delà
  de `freshnessDays` → STALE ; sans durée de fraîcheur, pas de péremption inventée.
- Tests : au moins succès, échec, périmé, absent par évaluateur (`tests/unit/evaluators.test.ts`) ; AIA-15-02 sur les
  jeux figés de `tests/fixtures/rules/aia-15-02/` (régénérés par `generate.mjs`).
- Preuves `system.*` émises par ProofLayer (`src/server/services/system-evidence.ts`) : `system.classification.signed`
  à la signature, `system.registry.snapshot` après chaque écriture de fiche et à la signature (une preuve par état).
  Elles portent `payload.systemId` : le moteur les rattache aux contrôles de ce système.
- AIA-06-02 reste évalué à la signature (faits de ProofLayer, version `internal.exemptionDossier@2`), hors registre.
- `createEvidence` ne lit stockage et clé maîtresse que pour une charge brute à chiffrer.

## Déploiement et observabilité (conventions établies par PL-108)
- Vercel (projet `prooflayer`, équipe « Tarik's projects ») : `vercel.json` épingle les fonctions à `fra1` ; Node 22.
  Build Vercel : `scripts/vercel-build.sh` (client Prisma ; en production seulement, `prisma migrate deploy` puis
  `pnpm controls:sync` si `DIRECT_DATABASE_URL` est fourni). Les prévisualisations ne touchent jamais au schéma.
- Variables : non secrètes posées sur le projet ; secrètes (`DATABASE_URL`, `DIRECT_DATABASE_URL`, `BETTER_AUTH_SECRET`,
  `CRON_SECRET`, `PROOFLAYER_MASTER_KEY`, `BREVO_API_KEY`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) saisies par le
  fondateur en type « sensitive », distinctes par environnement. Jamais de secret dans le dépôt ni dans la conversation.
- En-têtes : `src/lib/security-headers.ts` (purs) ; CSP à nonce par requête dans `src/proxy.ts` (pages dynamiques), en-têtes
  fixes (HSTS préchargé, `X-Frame-Options`, etc.) dans `next.config.ts`. Une origine externe nouvelle s'ajoute à la CSP.
- Emails : transport `brevo` (`BREVO_API_KEY`, `EMAIL_FROM`) ; erreur sans corps de réponse ni destinataire.
- Stockage objet : `OBJECT_STORE=s3` (Supabase Storage, bucket privé `prooflayer`, clés S3 dédiées, jamais la clé de service).
- Sentry : organisation en région UE, `src/instrumentation.ts` et `src/instrumentation-client.ts`, options et nettoyage
  dans `src/lib/sentry-scrub.ts` (`sendDefaultPii: false`, ni utilisateur, ni en-têtes, ni corps, ni variables locales ;
  emails et jetons masqués). Inactif sans `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`.
- Santé : `GET /api/health` (200 si la base répond, 503 sinon), pour la surveillance de disponibilité.

## Connexion Jira (conventions établies par PL-403)
- `src/server/connectors/jira/oauth.ts` (sans état, `fetch` injecté) : `state` signé HMAC (10 min, orgId + userId),
  `authorizeUrl`, `exchangeCode`, `refreshTokens` (`JiraOAuthError` : invalid_grant, http, invalid_response),
  `accessibleResources` / `usableSites`, `jiraApiUrl` (hôte `api.atlassian.com` fixe, cloudId UUID, chemin contrôlé).
- `src/server/services/jira-integration.ts` : `jiraAuthorizeUrl`, `completeJiraAuthorization` (state vérifié contre
  la session, site lié ailleurs → CONFLICT), `jiraAccessToken` (rafraîchissement sous `SELECT … FOR UPDATE` de la ligne
  `Integration`, invalid_grant → REVOKED), `jiraGet`. Jetons chiffrés AES-256-GCM sous la clé de données de
  l'organisation (AAD `integration:{orgId}:JIRA:{cloudId}`), jamais en clair en base, au journal ni dans une erreur.
- Routeur `integration.jira` (`authorizeUrl`, `complete`, rôle admin). Routes `/api/integrations/jira/start` et
  `/api/integrations/jira/callback` (sans logique) ; résultat affiché sur `/organization?jira=<clé>` (liste fermée,
  `src/lib/integration-status.ts`). Variables `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET`, `BETTER_AUTH_URL`.
- Tests : Atlassian simulé (`tests/integration/jira-integration.test.ts`), dont deux rafraîchissements concurrents.

## Synchronisation Jira (conventions établies par PL-404)
- Normaliseurs purs `src/server/connectors/jira/normalizers.ts` : `jira.issue.snapshot` (une preuve par jour et par état,
  `inMapping: false` à la sortie de correspondance) et `jira.issue.transitioned` (un changement de statut). Liste
  blanche : jamais description, commentaire, nom ni email ; identifiants de compte Atlassian seulement (`actor`).
  Fixtures `tests/fixtures/jira/issue/`.
- Correspondances : `IntegrationResource` `jira_query` (`externalId` `{systemId}:{purpose}`, config `{ jql, purpose,
  systemId, acceptanceField }`) reliée au système par `SystemResourceLink` ; finalités `risks`, `incidents`,
  `monitoring_reviews`, `release_validations` (`JIRA_PURPOSES`). Service `src/server/services/jira-mappings.ts`.
- `src/server/services/jira-sync.ts` : `syncIssue` (ticket relu avec `expand=changelog`, appartenance testée par
  `key = X AND (<jql>)`), `reconcile` (incrémentale `updated >= "-20m"` ou complète), `ensureWebhook` (un webhook par
  site, `project IN (…)` des projets utiles, prolongé à moins de 7 jours de l'expiration). Réseau avant écriture.
- Jobs `jira.issue.sync`, `jira.reconcile`, `jira.webhook.ensure` (`src/server/system/jobs/jira.ts`,
  `jiraJobDependencies` remplaçable par les tests). Cron `/api/cron/jira` toutes les 15 minutes ; complet chaque jour.
- Webhook `/api/webhooks/jira/[cloudId]` : JWT HS256 signé avec `JIRA_CLIENT_SECRET` (hypothèse du §4.5.2),
  identifiant `X-Atlassian-Webhook-Identifier`, livraison → job `jira.issue.sync`.
- Écran : onglet « Sources » de la fiche système (quatre correspondances, prévisualisation, enregistrement admin).
- Évaluateurs Jira `src/server/rules/evaluators/jira.ts` (AIA-09-01, 09-02, 09-03, 20-01, 72-02, 73-01) : dernier
  instantané de chaque ticket de la finalité, tickets sortis ignorés. Conventions : risque élevé = priorité Highest ou
  High ; acceptation = champ configuré sur la correspondance (absent → PARTIAL) ; incident grave = étiquette
  `serious-incident`, délai Art. 73 réduit par `incident-death` (10 j) ou `incident-critical-infrastructure` /
  `incident-widespread` (2 j), notification = passage à un statut « Notifié » / « Notified », compté depuis la création.

## Preuves manuelles et attestations (conventions établies par PL-405)
- `src/server/services/manual-evidence.ts` : `createUploadUrl` (adresse de dépôt direct `presignPut`, 10 min, vers la zone
  d'arrivée `orgs/{orgId}/incoming/` ; jeton d'enregistrement signé 30 min), `registerUpload` (type par extension, MIME
  et signature du contenu, 25 Mo, SHA-256 scellé dans l'enveloppe, fichier chiffré en `orgs/{orgId}/attachments/`, zone
  d'arrivée effacée), `attest` (mot de passe à essais limités, action `evidence.attestRefused`). Date de validité
  obligatoire ; `declarative: true` ; rattachement aux contrôles par `EvidenceLink` (`linkedBy` = utilisateur).
- Jetons signés génériques : `src/server/crypto/signed-token.ts` (usage + échéance, secret dérivé de BETTER_AUTH_SECRET).
- `ObjectStore.presignPut` : S3 (`@aws-sdk/s3-request-presigner`) ; local par `/api/uploads/local?t=` (jeton signé,
  refusé en production). L'origine `S3_ENDPOINT` est ajoutée à `connect-src` de la CSP.
- `createEvidence` accepte `attachment: { data, mime }`.
- Évaluateur `manual.evidencePresent` (`src/server/rules/evaluators/manual.ts`) : preuve rattachée par un utilisateur en
  cours de validité → PASS (« déclarative ») ; expirée ou durée de fraîcheur dépassée → STALE ; aucune → MISSING.
- Routeur `evidence` (`createUploadUrl`, `registerUpload`, `attest`, rôle contributor). Écran
  `/systems/[id]/controls/[controlId]/evidence`, lien « Ajouter une preuve » sur les contrôles manuels et semi-automatiques.

## Dashboard (conventions établies par PL-406)
- Fonctions pures `src/server/services/dashboard-data.ts` : `countStatuses` (non applicables à part, couverture =
  PASS / applicables), `articleOf` / `articleOrder` (regroupement par article), `coverageTimeline` (dernier statut évalué
  à la fin de chaque jour UTC, 90 jours), `dominantSource`, `connectorOf` (clé d'évaluateur → GITHUB ou JIRA).
- Service `src/server/services/dashboard.ts` : `systemSummary` (une transaction `withOrgTransaction`, requêtes agrégées ;
  « Connectez GitHub / Jira pour évaluer » si le connecteur manque et le contrôle est sans preuve), `orgSummary`.
  Routeur `dashboard` (`orgSummary`, `systemSummary`, `coverageTimeline`), lecture, tout membre. Exigence : vue système
  en moins de 1,5 s avec 5 000 preuves (`tests/integration/dashboard.test.ts`).
- Écrans : `/dashboard` (vue organisation, premier lien de la navigation) et `/systems/[id]/dashboard` (écran C, onglet
  avant « Contrôles ») : bandeau de synthèse, courbe SVG doublée d'un résumé et d'un tableau de données, explorateur
  filtrable (recherche, statut, article, responsable, source) dont les filtres vivent dans l'adresse (`router.replace`).
- Direction artistique : bleu institutionnel `--primary` #003399 et or `--gold` #ffcc00 purement décoratif (jamais
  porteur d'information ni de texte) ; aucun emblème ni visuel officiel de l'Union européenne.

## Détail d'un contrôle (conventions établies par PL-407)
- Fonctions pures `src/server/services/control-detail-data.ts` : `weeklyHistory` (12 semaines, lundi UTC, dernier
  statut de la semaine), `faultyEvidenceIds` / `orderEvidence` (preuves citées par les raisons d'une évaluation FAIL,
  PARTIAL ou STALE : fautives, en tête), `expectedEvidence` (types, chemin `docs/ai/…`, fraîcheur, connecteur, finalité
  Jira), `safeSourceUrl` (https seulement), `parseReasons` (colonne JSON relue sans confiance).
- Service `src/server/services/control-detail.ts`, routeur `control` : `get` (pages de 20 preuves), `evaluations`
  (lecture, tout membre), `assignOwner` (contributor, membre de l'organisation seulement), `setNotApplicable` (admin,
  justification de 20 caractères au moins ; réouverture → MISSING et `control.evaluate` programmé ; un contrôle écarté
  par reclassification ne se rouvre pas à la main), `comment` (contributor). Fiche archivée : CONFLICT `system.archived`.
- Table `ControlComment` (RLS, en ajout seul : UPDATE et DELETE retirés au rôle applicatif). Le texte d'un commentaire
  n'entre jamais au journal d'audit (identifiant et longueur seulement).
- Écran D : `/systems/[id]/controls/[controlId]` (`?page=`), accessible depuis l'onglet Contrôles et le dashboard.
  Libellés des types de preuves : `evidenceKinds.<type avec _>` dans `messages/{fr,en}.json`.

## Alertes par email (conventions établies par PL-408)
- Fonctions pures `src/server/services/notifications-data.ts` : `isRegression` (PASS → FAIL seulement), `digestForUser`
  (owner et admin : tout ; contributor et auditor : contrôles et systèmes dont ils sont responsables, jamais les
  connecteurs ; vide → `null`, aucun email), `expiryWindow` (14 jours, §3.2 E5), `digestRunAt` (05:47 UTC).
  Emails : `src/server/email/notification-emails.ts` (langue du destinataire, `emails.controlFailed` et `emails.digest`,
  liens `BETTER_AUTH_URL`, jamais de charge de preuve).
- Régression : `writeEvaluation` appelle `notifyRegression` dans la transaction de l'évaluation → `Notification`
  `control.failed` pour le responsable du contrôle, à défaut celui du système, et job `notification.email`
  (`src/server/system/jobs/notifications.ts`, idempotent par `emailedAt` ; rien si le contrôle n'est plus en échec, si
  la préférence est coupée ou si le destinataire n'est plus membre).
- Résumé : `/api/cron/daily` → `scheduleDailyDigests` (`src/server/system/notification-schedule.ts`), un job
  `notification.digest` par utilisateur et par jour (clé datée, sans orgId) ; `sendDailyDigest` parcourt ses
  organisations en positionnant `app.org_id` dans la transaction du job, envoie un seul email et marque chaque
  organisation reprise d'une `Notification` `digest.daily` (`payload.day`), qui empêche un second envoi le même jour.
- Préférences : table `NotificationPreference` (orgId, userId ; RLS ; sans ligne, tout est actif). Routeur
  `notification` (`list`, `markRead`, `preferences.get`, `preferences.set`, tout membre). Écran `/notifications`
  (préférences, dernières alertes), lien de la navigation et du pied de chaque email.

## Scellement par lots (conventions établies par PL-501)
- `src/server/seal/batch.ts` (pur) : `sortForSealing` (capturedAt puis identifiant), `batchHeader` / `batchHash`
  (`SHA-256(JCS({ v, org, seq, leafCount, merkleRoot, prevBatchHash, sealedAt }))`, empreintes en hexadécimal, date ISO
  à la milliseconde, `ZERO_HASH` pour seq = 1), `chainBreak` (continuité de la chaîne, §4.6.3 étape 3).
- `verifyInclusion` exige un chemin consommé en entier (RFC 9162 §2.1.3.2). Propriétés exhaustives sur 1 à 257 feuilles :
  `tests/unit/merkle-properties.test.ts`.
- `sealOrg(tx, orgId, now)` (`src/server/services/seal.ts`) : verrou consultatif de transaction par organisation
  (`pg_advisory_xact_lock(hashtextextended('seal:' || orgId, 0))`), 5 000 feuilles au plus par lot, lot et rattachement
  (`sealBatchId`, `leafIndex`) écrits dans la même transaction, tout annulé si une preuve manque.
- Job `seal.org` (`src/server/system/jobs/seal.ts`, orgId, clé `seal.org:{orgId}:{AAAA-MM-JJTHH}`), cron `/api/cron/seal`
  à la minute 3 de chaque heure (`scheduleHourlySealing`).
- En base : `evidence_guard` fige `leafIndex` avec le lot (posés ensemble) ; `seal_batch_guard` rend `SealBatch` en
  ajout seul (seuls `anchorId` et `anchorLeafIndex` se posent, une fois ; suppression seulement sous `app.purge_org`).

## Ancrage et horodatage RFC 3161 (conventions établies par PL-502)
- `src/server/seal/tsa.ts` (pkijs, asn1js) : `requestTimestamp(digest, config, trustAnchors, fetch?)` (version 1, SHA-256,
  nonce de 8 octets, certReq ; refus si statut ≠ granted/grantedWithMods, empreinte, nonce ou politique différents,
  signature CMS invalide, chaîne inconnue, signataire sans id-kp-timeStamping), `verifyTimestamp` (sans réseau,
  asynchrone : WebCrypto). Erreur typée `TsaError` (`retryable` pour délai, réseau, HTTP). Seule l'empreinte part.
- pkijs exige les données d'origine pour un TSTInfo : l'empreinte est vérifiée par nous, puis `eContentType` est passé à
  id-data pour que pkijs vérifie messageDigest, signature et chaîne (l'attribut signé contentType reste contrôlé).
- `src/server/seal/tsa-config.ts` : `tsaSetup(env)` ; hors production sans configuration, freetsa.org (racine épinglée,
  non qualifié) ; en production, `TSA_URL` + `TSA_TRUST_PEM` obligatoires (`TSA_NAME`, `TSA_POLICY_OID`, `TSA_QUALIFIED`,
  secrets `TSA_USER` / `TSA_PASSWORD`), sinon refus d'ancrer. Fixture réelle : `tests/fixtures/tsa/` (openssl ts -verify).
- `src/server/seal/anchor.ts` (pur) : batchHash triés par octets, `anchorHeader` / `anchorHash`
  (`SHA-256(JCS({ v, seq, merkleRoot, batchCount, prevAnchorHash }))`), `anchorOverdue` (6 h + 2 h).
- `src/server/system/anchoring.ts` : `anchorPendingBatches` (verrou `seal:anchor`, fonctions SQL `SECURITY DEFINER`
  `pending_batches_for_anchor` et `attach_batches_to_anchor`, horodatage puis ancre et rattachement en une transaction ;
  échec : rien d'écrit, alerte `seal.anchorOverdue` via `raiseOperationalAlert`, `src/server/system/alerts.ts`).
- Job `seal.anchor` (sans orgId, `anchorDependencies` remplaçable par les tests), cron `/api/cron/anchor` toutes les 6 h
  (`scheduleAnchoring`, fenêtre `AAAA-MM-JJTHH`), à la demande `requestAnchorNow` (export, PL-504). `Anchor` en ajout seul.
- Test réel : `TSA_LIVE=1` (en local derrière le proxy : `NODE_USE_ENV_PROXY=1`).

## Preuve d'inclusion et revérification quotidienne (conventions établies par PL-503)
- `src/server/seal/chain.ts` (pur) : `buildProof` / `verifyProof` (feuille → racine du lot → batchHash → racine de
  l'ancre → anchorHash → jeton ; `anchor: null` tant que le lot attend), `leafIssues` (contentSha256 sur la charge,
  leafHash sur sel et enveloppe, sauf effacement), `batchIssues` (racine, nombre de feuilles, empreinte, chaînage),
  `anchorIssues`. `storedBatchHeader` / `storedAnchorHeader` relisent un en-tête stocké.
- `Anchor.batchHashes` : feuilles de l'ancre conservées sur l'ancre (une purge d'organisation ne rend pas invérifiables
  les ancres partagées) ; écrites à la création par `anchorPendingBatches`.
- `evidence.proof` (`src/server/services/evidence-proof.ts`, lecture, tout membre) ; JSON téléchargeable
  `/api/evidence/[id]/proof` (sans logique). Écran D : colonne « Scellement » (empreinte abrégée, lot, ancre, date du jeton).
- Revérification : `/api/cron/verify` chaque jour (03:41 UTC) → `scheduleChainVerification` (`seal-schedule.ts`) : job
  `seal.verifyOrg` par organisation (`verifyOrgChain`, `src/server/services/chain-verification.ts`, dont le rattachement
  lot → feuille de l'ancre) et job `seal.verifyAnchors` (`src/server/system/chain-verification.ts`, jetons revérifiés
  contre la racine du prestataire nommé sur l'ancre). Anomalie : alerte `seal.integrityFailure` (codes, numéros, jamais
  de contenu).
- Tests : corruption simulée sous le rôle propriétaire avec `SET session_replication_role = replica` (session seule).

## Pack d'audit (conventions établies par PL-504)
- Format (contrat relu par l'outil de PL-505), `src/server/pack/contents.ts` (pur) : `manifest.json` (identité, période,
  décomptes, empreinte SHA-256 de chaque autre fichier, signature), `report.pdf`, `controls.json` (tous les contrôles,
  jamais filtrés), `evidence/<id>.json` (charge, sel, enveloppe, `seal: { batch, leafIndex }`, `declarative`, pièce jointe
  en clair `evidence/<id>.<ext>`), `proofs/batches/<seq>.json` (TOUTES les feuilles du lot : une omission est visible),
  `proofs/anchors/<seq>.json` + `.tst` (jeton DER), `proofs/tsa/<nom>.pem`, `VERIFY.md` (étapes openssl).
- Signature `src/server/pack/signing.ts` : Ed25519 sur le JCS du manifeste sans `signature`. Production :
  `PACK_SIGNING_KEY` (PKCS#8, PEM ou DER base64, sensible) et `PACK_SIGNING_KID` (`pl-AAAA-MM`), sinon refus ; hors
  production, clé `pl-dev` dérivée de BETTER_AUTH_SECRET. Clés publiques : table `SigningKey` (upsert à la génération),
  servies par `/.well-known/prooflayer-keys.json` (sans `pl-dev` en production).
- `src/server/services/packs.ts` : `createPack` (admin, période ≤ 400 j, fin ≤ aujourd'hui), `buildPack` (job `pack.build`,
  orgId, 4 tentatives : scelle, ancre à la demande — sans prestataire en production, lots marqués non ancrés —, rassemble,
  rend, signe, écrit `orgs/{orgId}/packs/{id}.zip`, notification `pack.ready` + email). Divulguées : preuves des lots de
  la période liées aux contrôles du système ou `system.*` du système. Panne passagère → nouvel essai ; sinon FAILED.
- Routeur `pack` : `create`, `list`, `get`, `downloadUrl`, `download` (contenu, pour la route `/api/packs/[id]/download`,
  journalisé `pack.download`), `preview`. Écran E `/systems/[id]/packs` (onglet « Packs »).
- Rapport PDF `src/server/pack/report.tsx` (`packReport`) : 100 preuves listées par contrôle au plus, puis le décompte.
  Pied de page react-pdf positionné par `top` (avec `bottom` et un lineHeight hérité, il disparaît).
- `VERIFY.md` : `packVerify.body` lu brut (`t.raw`, accolades littérales), `{kid}` et `{keysUrl}` remplacés.
- Exemple à relire : `PACK_SAMPLE_OUT=<fichier>.zip` sur `tests/integration/pack.test.ts`.

## Outil de vérification (conventions établies par PL-505)
- `packages/verify/` (`@prooflayer/verify`, MIT) : implémentation indépendante, sans import de l'application ni module
  Node hors `src/bin.ts` (règle ESLint) ; WebCrypto, fflate, pkijs, asn1js. Le cœur (`verifyPack`) resservira à la
  page publique de vérification (PL-508). Imports relatifs en `.js` (build NodeNext : `pnpm verify:build`, en CI).
- `verifyPack(zip, { keys, tsaRoots })` : six étapes du §4.6.3 (`STEPS`), anomalies typées (`ISSUE_CODES`, erreur ou
  avertissement, 50 détaillées par étape puis le décompte). `ok` = aucune erreur (code 0) ; `clean` = ni erreur ni
  avertissement (`--strict`). Avertissements : lot non ancré, prestataire non qualifié, pièce jointe non jointe.
- Confiance épinglée dans `src/trust.ts` (`PINNED_KEYS` sans `pl-dev`, `PINNED_TSA_ROOTS` avec leur qualification) ;
  les racines jointes au pack ne sont jamais crues ; `--trust-key` / `--trust-tsa` ajoutent une confiance explicite
  (une racine ajoutée n'est jamais réputée qualifiée). Nouvelle clé ou nouveau prestataire = nouvelle version du paquet.
- Textes fr et en dans `src/messages.ts` (le paquet ne lit pas messages/{fr,en}.json).
- Tests : `packages/verify/test/` sur des packs produits par le code de l'application, altérations comprises ;
  prestataire d'horodatage de test `tests/helpers/test-tsa.ts` (racine et jetons générés, sans réseau), utilisé aussi
  par `tests/integration/pack.test.ts`, dont le pack généré par le job doit passer `verifyPack`.

## Gabarits Annexe IV et déclaration UE (conventions établies par PL-506)
- `src/server/pack/templates.ts` (pur) : `buildTemplates(input, labels)` → `templates/annex-iv.md` (9 rubriques de
  l'Annexe IV, Art. 11(1)) et `templates/eu-declaration.md` (8 mentions de l'Annexe V, Art. 47), en Markdown, joints à
  chaque pack (`PackInput.templates`, listés au manifeste) et décomptés dans le rapport PDF (`packTemplates.report`).
- Préremplissage depuis le registre (fiche, modèles, catégories de données, responsables, classification signée,
  modifications de conception) ; contrôles suivis par rubrique : `ANNEX_IV_CONTROLS`. États `EMPTY` (« ⚠ À rédiger »)
  ou `PARTIAL` (préremplie, à compléter) : aucune rubrique n'est jamais déclarée complète.
- Annexe V point 4 : jamais rédigé par ProofLayer (règle 7), laissé au fournisseur ; rôle autre que fournisseur →
  avertissement (la déclaration incombe au fournisseur tiers). Titre légal « Déclaration UE de conformité » conservé.
- Rubriques établies d'après le règlement 2024/1689 (le cahier ne les énumère pas) : relecture par l'avocat partenaire.
- Textes : `packTemplates` dans messages/{fr,en}.json ; libellés par `templateLabels(locale)` (`template-labels.ts`).

## Effacement d'une preuve (conventions établies par PL-507)
- `src/server/services/evidence-redaction.ts` : `redactEvidence` (routeur `evidence.redact`, admin) : ligne verrouillée
  (`FOR UPDATE`), charge brute et pièce jointe supprimées du stockage d'abord (idempotent), puis payload, actor, salt,
  `rawObjectKey`, `attachmentKey` à NULL et `redactedAt` posé, dans une transaction. Motif en liste fermée
  (`REDACTION_REASONS`), jamais de texte libre ; journal `evidence.redact` sans aucun contenu. Déjà effacée : CONFLICT
  `evidence.alreadyRedacted`. `redactionStorage` remplaçable par les tests.
- `evidence_guard` (migration 20261114090000) : acteur, sel, charge brute et pièce jointe ne vont que vers NULL ; le sel
  ne disparaît qu'avec l'effacement ; `redactedAt` posé une fois, jamais retiré ; preuve effacée sans charge ni fichiers.
- Leaf, enveloppe et place dans le lot demeurent : `verifyOrgChain`, `evidence.proof`, le pack et `@prooflayer/verify`
  passent toujours (preuve comptée « effacée »). Une preuve effacée ne nourrit plus les évaluations (charge absente).
- Écran D : action « Effacer » (admin, motif, confirmation explicite), preuve ensuite affichée « Preuve effacée ».
