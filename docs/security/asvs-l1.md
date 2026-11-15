# Revue OWASP ASVS 4.0.3 — niveau 1 (PL-605)

État au 15 novembre 2026. Chaque exigence de niveau 1 applicable est rattachée à sa mise en œuvre ou à un écart.
Légende : ✅ en place · 🔧 corrigé par PL-605 · ⚠ écart consigné (traitement prévu) · — sans objet.

## V1 Architecture (niveau 1 : exigences reportées aux niveaux 2 et 3)

— Aucune exigence de niveau 1. Modèle de menaces implicite : §4.7 du cahier des charges.

## V2 Authentification

| Exigence                                                 | État | Mise en œuvre                                                                                                                |
| -------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| 2.1.1 mot de passe ≥ 12 caractères                       | ✅   | `minPasswordLength: 12` (`src/server/auth.ts`)                                                                               |
| 2.1.2 jusqu'à 128 caractères                             | ✅   | `maxPasswordLength: 128`                                                                                                     |
| 2.1.3–2.1.4 pas de troncature, Unicode accepté           | ✅   | Better Auth (scrypt), aucune règle de composition                                                                            |
| 2.1.5 / 2.1.6 changement et réinitialisation             | ✅   | Better Auth ; `revokeSessionsOnPasswordReset`                                                                                |
| 2.1.7 mots de passe compromis refusés                    | ⚠    | Plugin `haveIBeenPwned` non activé : appel réseau sortant (k-anonymat) à décider avec le fondateur                           |
| 2.1.9 pas de règle de composition                        | ✅   | Aucune                                                                                                                       |
| 2.1.12 afficher le mot de passe saisi                    | ⚠    | Champ masqué sans bouton « afficher » : à ajouter à l'écran de connexion (PL-606/607)                                        |
| 2.2.1 protection contre la force brute                   | 🔧   | Limite de débit Better Auth stockée en base (`RateLimit`, partagée entre instances) ; signature : 5 essais par quart d'heure |
| 2.2.2 pas de SMS ni d'email comme second facteur         | ✅   | TOTP et codes de secours uniquement                                                                                          |
| 2.2.3 notification des changements de sécurité           | ⚠    | Pas d'email à l'activation/retrait de la 2FA ni au changement de mot de passe : à ajouter                                    |
| 2.3.1 secrets initiaux aléatoires                        | ✅   | Liens de vérification et d'invitation Better Auth, à usage unique et à échéance                                              |
| 2.5.1–2.5.4 récupération sans indice ni question secrète | ✅   | Lien de réinitialisation par email uniquement                                                                                |
| 2.5.6 lien de réinitialisation à durée limitée           | ✅   | Better Auth (1 h)                                                                                                            |
| 2.7.x / 2.8.x OTP                                        | ✅   | TOTP RFC 6238, 2FA obligatoire pour owner et admin (`/setup-two-factor`)                                                     |

## V3 Sessions

| Exigence                                                                      | État | Mise en œuvre                                                                        |
| ----------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------ |
| 3.1.1 jeton jamais dans l'URL                                                 | ✅   | Cookie seulement ; la session est désignée par son identifiant, jamais par son jeton |
| 3.2.1–3.2.3 jeton neuf à la connexion, aléatoire, cookie                      | ✅   | Better Auth                                                                          |
| 3.3.1 déconnexion effective                                                   | ✅   | Session supprimée en base                                                            |
| 3.3.2 expiration                                                              | ✅   | 7 jours glissants (défaut Better Auth)                                               |
| 3.4.1–3.4.5 `Secure`, `HttpOnly`, `SameSite=Lax`, préfixe `__Secure-`, chemin | ✅   | Défauts Better Auth en HTTPS                                                         |
| 3.7.1 réauthentification avant opération sensible                             | ✅   | Mot de passe exigé pour signer une classification, un dossier, une attestation       |

## V4 Contrôle d'accès

| Exigence                                              | État | Mise en œuvre                                                                                           |
| ----------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------- |
| 4.1.1–4.1.3 contrôle côté serveur, moindre privilège  | ✅   | `withRole`, `orgProcedure` ; `tests/integration/rbac.test.ts` vérifie chaque procédure et chaque rôle   |
| 4.1.5 refus par défaut                                | ✅   | Procédure sans rôle déclaré : membre de l'organisation active seulement                                 |
| 4.2.1 IDOR                                            | ✅   | RLS forcé (`tenant_isolation`), `forOrg` ; `tests/integration/cross-org.test.ts` (inventaire exhaustif) |
| 4.2.2 CSRF                                            | ✅   | Better Auth vérifie l'origine (`trustedOrigins`) ; tRPC en POST JSON ; cookies `SameSite=Lax`           |
| 4.3.1 2FA pour l'administration                       | ✅   | owner et admin                                                                                          |
| 4.3.2 pas de listing de répertoires ni de métadonnées | ✅   | Vercel ; aucun fichier statique sensible                                                                |

## V5 Validation, assainissement, encodage

| Exigence                                          | État | Mise en œuvre                                                                                   |
| ------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------- |
| 5.1.1–5.1.4 validation positive des entrées       | ✅   | Zod sur chaque procédure, route et charge de webhook                                            |
| 5.1.5 redirections vers des adresses de confiance | ✅   | `safePath()` pour `?next=`                                                                      |
| 5.2.x assainissement, injection de formules       | ✅   | React échappe par défaut ; aucun `dangerouslySetInnerHTML` sur donnée utilisateur ; CSV protégé |
| 5.3.3 / 5.3.4 XSS, SQL                            | ✅   | Prisma paramétré ; `$queryRaw` en gabarit balisé seulement                                      |
| 5.3.8 injection de commande                       | —    | Aucun appel système                                                                             |
| 5.5.x désérialisation                             | ✅   | JSON seulement, revalidé par Zod                                                                |

## V6 Cryptographie stockée

| Exigence                                         | État | Mise en œuvre                                                                                                         |
| ------------------------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------- |
| 6.2.1–6.2.3 modules éprouvés, modes authentifiés | ✅   | AES-256-GCM (Node crypto), Ed25519, SHA-256, WebCrypto                                                                |
| 6.3.1 aléa cryptographique                       | ✅   | `randomBytes`, `crypto.getRandomValues`                                                                               |
| 6.4.x gestion des clés                           | ✅   | Clés de données par organisation enveloppées par `PROOFLAYER_MASTER_KEY` ; secrets en variables « sensitive » Vercel  |
| — données au repos                               | 🔧   | Revue finale : packs et exports chiffrés par la clé de l'organisation ; charges de webhooks effacées après traitement |

## V7 Erreurs et journalisation

| Exigence                                              | État | Mise en œuvre                                                                                            |
| ----------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------- |
| 7.1.1 / 7.1.2 ni secret ni jeton ni charge au journal | ✅   | Règle 8 ; `sentry-scrub.ts` ; journal d'audit sans contenu                                               |
| 7.4.1 message d'erreur générique                      | 🔧   | `safeErrorShape` (`src/server/error-shape.ts`) : erreur interne → `internal_error`, pile jamais renvoyée |

## V8 Protection des données

| Exigence                                                 | État | Mise en œuvre                                                           |
| -------------------------------------------------------- | ---- | ----------------------------------------------------------------------- |
| 8.2.1 pas de cache des données sensibles                 | ✅   | Pages dynamiques ; téléchargements en `Content-Disposition: attachment` |
| 8.3.1 données sensibles hors de l'URL                    | ✅   | POST JSON ; jetons de dépôt à courte échéance                           |
| 8.3.2 export et suppression des données de l'utilisateur | ⚠    | Export et suppression d'organisation livrés par PL-607                  |

## V9 Communications

| Exigence                                   | État | Mise en œuvre                           |
| ------------------------------------------ | ---- | --------------------------------------- |
| 9.1.1–9.1.3 TLS partout, versions récentes | ✅   | Vercel (TLS 1.2+), HSTS préchargé 2 ans |

## V10 Code malveillant

| Exigence                  | État | Mise en œuvre                                                                                         |
| ------------------------- | ---- | ----------------------------------------------------------------------------------------------------- |
| 10.3.1 mises à jour sûres | ✅   | Versions épinglées (`pnpm-lock.yaml`), délai de 24 h avant adoption                                   |
| — dépendances vulnérables | 🔧   | `pnpm deps:audit` (seuil `high`) bloquant dans le job CI `checks`                                     |
| — secrets dans le code    | 🔧   | `pnpm secrets:scan` (secretlint) bloquant en CI ; protection à l'envoi GitHub à activer (voir écarts) |

## V11 Logique métier

| Exigence                                                    | État | Mise en œuvre                                                                                                                       |
| ----------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 11.1.1–11.1.4 ordre des étapes, limites anti-automatisation | 🔧   | Signatures conditionnées ; limites de débit API (600/min/IP), webhooks (1 200/min/IP), classifieur public (3/adresse/jour, 10/IP/h) |

## V12 Fichiers

| Exigence                                  | État | Mise en œuvre                                                    |
| ----------------------------------------- | ---- | ---------------------------------------------------------------- |
| 12.1.1 taille maximale                    | ✅   | 25 Mo (`registerUpload`)                                         |
| 12.3.1 / 12.3.2 nom de fichier non fiable | ✅   | Clé de stockage générée (`orgs/{orgId}/…`), jamais le nom fourni |
| 12.4.1 stockage hors racine web           | ✅   | Bucket privé, chiffré par organisation                           |
| 12.5.1 type vérifié                       | ✅   | Extension, MIME et signature du contenu                          |
| 12.5.2 `Content-Disposition`              | ✅   | `attachment` sur tous les téléchargements, nom assaini           |

## V13 API et services web

| Exigence                         | État | Mise en œuvre                                                                       |
| -------------------------------- | ---- | ----------------------------------------------------------------------------------- |
| 13.1.1 encodage uniforme         | ✅   | JSON UTF-8                                                                          |
| 13.1.3 pas de secret dans l'URL  | ⚠    | Exception : `/api/uploads/local?t=` (développement seulement, refusé en production) |
| 13.2.1 méthodes HTTP restreintes | ✅   | Route handlers déclarant seulement leurs méthodes                                   |
| 13.2.5 type de contenu vérifié   | ✅   | Webhooks : corps brut signé avant analyse                                           |

## V14 Configuration

| Exigence                       | État | Mise en œuvre                                                                                                  |
| ------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------- |
| 14.2.1 composants à jour       | 🔧   | Audit bloquant ; une vulnérabilité modérée consignée sous le seuil (voir écarts)                               |
| 14.3.2 mode débogage désactivé | ✅   | Build de production ; pile jamais renvoyée (7.4.1)                                                             |
| 14.4.1–14.4.7 en-têtes         | ✅   | CSP à nonce, `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS |
| 14.5.3 CORS                    | ✅   | Aucun `Access-Control-Allow-Origin` générique                                                                  |

## Écarts consignés

1. **2.1.7** — vérification des mots de passe compromis : décision du fondateur requise (appel sortant vers un tiers).
2. **2.1.12** — bouton « afficher le mot de passe » à ajouter aux écrans d'authentification.
3. **2.2.3** — email de sécurité à l'activation ou au retrait de la 2FA et au changement de mot de passe.
4. ~~**8.3.2** — export et suppression~~ : livrés par PL-607.
5. **Protection à l'envoi** — l'analyse de secrets de GitHub (_push protection_) s'active dans les réglages du dépôt
   par son propriétaire ; secretlint en CI ne bloque qu'après l'envoi.
6. **Dépendance modérée** — `minimatch` < 11.0.1 (GHSA-g3hv-75wg-m249, déni de service par motif), outillage ESLint
   seulement (jamais livré en production), sous le seuil bloquant `high` ; levée à la prochaine mise à jour d'ESLint.
