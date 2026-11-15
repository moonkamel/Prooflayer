# Runbook d'exploitation et d'incident (PL-609)

Pour un fondateur seul : être alerté avant le client, savoir quoi faire, savoir restaurer. Mis à jour à chaque
incident (section 6) et à chaque exercice de restauration (section 5).

## 1. Surveillance

| Signal                           | Source                                                              | Seuil                               | Où arrive l'alerte       |
| -------------------------------- | ------------------------------------------------------------------- | ----------------------------------- | ------------------------ |
| Disponibilité                    | Better Stack (plan gratuit) sur `GET /api/health`, toutes les 3 min | 503 ou délai > 10 s                 | email + SMS du fondateur |
| Base injoignable                 | `/api/health` → `database: down`                                    | immédiat                            | Better Stack             |
| Crons arrêtés / file non drainée | `/api/health` → `queue: lagging` ; `ops.queueLagging`               | job dû depuis > 10 min, bail expiré | Better Stack, Sentry     |
| Livraisons webhook bloquées      | `ops.webhookLagging`                                                | en attente depuis > 10 min          | Sentry                   |
| Ancre manquée                    | `seal.anchorOverdue` (surveillance + job d'ancrage)                 | lot non ancré depuis > 8 h          | Sentry                   |
| Chaîne de scellement             | `seal.integrityFailure` (revérification quotidienne)                | toute anomalie                      | Sentry                   |
| Connecteur en erreur             | `ops.connectorError` (par fournisseur et statut)                    | ERROR ou REVOKED                    | Sentry                   |
| Taux d'échec                     | `ops.errorRate` (jobs, webhooks, dernière heure)                    | > 10 % sur ≥ 20 opérations          | Sentry                   |
| Erreurs applicatives             | Sentry (erreurs non gérées)                                         | règle d'alerte Sentry               | email                    |
| Facturation                      | `billing.orgMissing`, `billing.unknownPrice`                        | toute occurrence                    | Sentry                   |

La surveillance interne tourne par `/api/cron/monitor` (minutes 7, 22, 37 et 52 de chaque heure). Les alertes ne
contiennent que des codes, des décomptes et des âges : jamais d'identifiant de client, de contenu ni de jeton.

**À configurer une fois (fondateur) :**

1. Better Stack : moniteur HTTP sur `https://<domaine>/api/health`, attendu 200, toutes les 3 minutes, région UE.
2. Sentry (organisation UE) : règle d'alerte « un événement avec l'étiquette `alert` est vu » → email immédiat ;
   règle « nombre d'erreurs > 20 en 10 minutes » → email.
3. Vercel : vérifier que les crons de `vercel.json` sont actifs (onglet Cron Jobs).

## 2. Niveaux de gravité

| Niveau        | Exemples                                                                                 | Délai de prise en charge |
| ------------- | ---------------------------------------------------------------------------------------- | ------------------------ |
| S1 — critique | fuite ou accès entre organisations, preuve altérée, base perdue, `seal.integrityFailure` | immédiat                 |
| S2 — majeur   | service indisponible, crons arrêtés, ancrage en échec > 8 h, emails non envoyés          | < 2 h ouvrées            |
| S3 — mineur   | un connecteur client en erreur, lenteur, taux d'échec ponctuel                           | < 1 jour ouvré           |

## 3. Déroulé d'un incident

1. **Détecter et qualifier** : noter l'heure, l'alerte, le niveau. Ouvrir une fiche (section 6).
2. **Confiner**
   - Fuite ou compromission : révoquer les secrets concernés (Vercel « sensitive » : `BETTER_AUTH_SECRET` révoque
     toutes les sessions, `CRON_SECRET`, `GITHUB_WEBHOOK_SECRET`, `JIRA_CLIENT_SECRET`, `STRIPE_WEBHOOK_SECRET`,
     clés S3) ; suspendre le déploiement fautif (Vercel → Instant Rollback) ; au besoin, mettre le projet en pause.
   - Webhooks : la boîte de réception rejoue d'elle-même (8 tentatives) ; un lot en échec se relance en repassant les
     livraisons `FAILED` en `PENDING`.
   - Ancrage : vérifier le prestataire (`TSA_URL`) ; les lots attendent sans perte et partent dans l'ancre suivante.
   - Intégrité : **ne rien corriger à la main**. Relever `pnpm chain:verify` (JSON), conserver la base en l'état
     (sauvegarde immédiate), comparer à la dernière sauvegarde saine.
3. **Notifier**
   - Données personnelles des preuves (ProofLayer sous-traitant, Art. 28 et 33(2) RGPD) : informer **sans délai**
     les owners des organisations touchées, avec les éléments de l'Art. 33(3) connus (nature, catégories et nombre
     approximatif de personnes et d'enregistrements, conséquences probables, mesures prises), pour leur permettre de
     tenir leurs 72 heures.
   - Données dont ProofLayer est responsable (comptes, facturation, prospection) : notification à la CNIL dans les
     72 heures (Art. 33(1)) sauf risque improbable ; information des personnes si risque élevé (Art. 34).
   - Indisponibilité : email aux owners et admins des organisations touchées, puis à la résolution.
4. **Rétablir** : correctif, ou restauration (section 4) ; vérifier `/api/health`, `pnpm chain:verify`, la file.
5. **Retour d'expérience** sous 5 jours ouvrés : chronologie, cause racine, ce qui a marché, actions (avec échéance),
   mise à jour de ce runbook.

## 4. Restauration complète

### Base de données

Sauvegardes quotidiennes de Supabase (région Francfort). Exercice chaque trimestre et avant le premier client payant :

1. Créer un projet Supabase vierge (même région) ou une base Postgres 16 jetable.
2. Lancer, depuis un poste qui atteint les deux bases (connexions directes, port 5432) :
   ```
   RESTORE_SOURCE_URL=<base à restaurer> RESTORE_TARGET_URL=<base vierge> RESTORE_CONFIRM=jetable pnpm restore:drill
   ```
   Le script sauvegarde la source (`pg_dump`), restaure sur la cible vierge (`pg_restore`, transaction unique), compare
   le nombre de lignes de chaque table puis revérifie toute la chaîne de scellement sur la source et sur la cible
   (`pnpm chain:verify`) : le résultat doit être identique, et sans anomalie en production.
3. Pour restaurer réellement : pointer `DATABASE_URL` et `DIRECT_DATABASE_URL` (Vercel, Production) vers la base
   restaurée, redéployer, vérifier `/api/health` et `pnpm chain:verify`.
4. Consigner la durée dans le tableau ci-dessous.

### Stockage objet et secrets

- Charges brutes, pièces jointes, packs et exports sont dans Supabase Storage (bucket `prooflayer`), chiffrés par
  organisation. La restauration de la base ne les restaure pas : ils restent en place tant que le bucket existe.
- La clé maîtresse `PROOFLAYER_MASTER_KEY` et la clé de signature `PACK_SIGNING_KEY` sont conservées hors ligne par
  le fondateur (gestionnaire de mots de passe + copie papier sous scellé) : sans la clé maîtresse, aucune charge ni
  pièce jointe n'est lisible après restauration.

### Journal des exercices

| Date       | Environnement                       | Volume                                                       | Sauvegarde | Restauration | Vérifications | Total | Résultat                                                                               |
| ---------- | ----------------------------------- | ------------------------------------------------------------ | ---------- | ------------ | ------------- | ----- | -------------------------------------------------------------------------------------- |
| 2026-11-15 | Postgres 16 local → base vierge     | 40 tables, 20 039 lignes, 5 000 preuves scellées, 161 ancres | 0,3 s      | 0,5 s        | 6,3 s         | ≈ 7 s | ✅ chaîne identique (anomalies d'ancres de test présentes à l'identique sur la source) |
| à faire    | Supabase production → projet vierge |                                                              |            |              |               |       |                                                                                        |

## 5. Commandes utiles

| Besoin                               | Commande                                |
| ------------------------------------ | --------------------------------------- |
| Revérifier toute la chaîne           | `DATABASE_URL=<base> pnpm chain:verify` |
| Exercice de restauration             | `pnpm restore:drill` (voir section 4)   |
| Entonnoir d'activation               | `pnpm funnel:report`                    |
| Publier la bibliothèque de contrôles | `pnpm controls:sync`                    |
| Santé                                | `curl -s https://<domaine>/api/health`  |

## 6. Fiche d'incident (modèle)

```
Incident n° AAAA-MM-JJ-n — niveau S?
Détecté le : … par : (alerte / client / autre)
Organisations touchées : (nombre ; identifiants dans le dossier privé, jamais dans un outil tiers)
Chronologie : …
Confinement : …
Notifications : owners le … ; CNIL le … (ou motif d'absence)
Cause racine : …
Actions : … (responsable, échéance)
```
