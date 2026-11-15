# Session de mise en route d'un design partner (PL-610, §7.5)

Une heure, en visio, avec le CTO et la personne qui suivra ProofLayer au quotidien. Objectif : sortir de la session
avec une classification signée, GitHub et Jira connectés, des preuves capturées et un premier pack, c'est-à-dire mesurer
l'hypothèse du §1.4 en conditions réelles (« en moins de 60 minutes »).

## Avant la session (fondateur)

1. Le partenaire a signé l'engagement de pilote (§7.5) et créé son espace (inscription, organisation, 2FA).
2. `pnpm partners add <orgId> <hr_tech|fintech|exemption>` : pilote de 12 semaines sans paiement, limites du plan
   Growth. L'identifiant d'organisation se lit dans la base ; il n'est jamais écrit dans le dépôt.
3. Envoyer la veille : l'ordre du jour ci-dessous, la demande d'accord pour l'enregistrement, la liste des prérequis
   (droits d'administration GitHub sur les dépôts du système, droits d'administration Jira, nom du système).
4. Préparer le code promotionnel Stripe « Growth −50 % la première année » (Stripe → Produits → Coupons) : il sera
   saisi par le partenaire au moment de souscrire (Checkout accepte les codes promotionnels).

## Enregistrement

- Enregistrer **seulement avec l'accord exprès** de chaque participant, recueilli à l'écrit avant et rappelé au début
  (article 6(1)(a) du RGPD) ; finalité : améliorer la mise en route ; conservation : 12 mois ; accès : fondateur seul.
- Ne pas filmer de contenu de dépôt ni de ticket : partager l'écran ProofLayer, pas l'outil source.
- Conserver l'enregistrement hors ProofLayer (stockage du fondateur), jamais dans le dépôt ni dans un outil d'analyse.

## Déroulé (60 minutes, chronomètre lancé à l'inscription déjà faite)

| Minute | Étape                                                                                       | Ce qu'on vérifie                                  |
| ------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 0–5    | Contexte : échéance datée (appel d'offres, audit, levée), système concerné                  | le profil du §7.5 est tenu                        |
| 5–15   | Registre puis questionnaire de classification, signature                                    | classification signée (étape 2 de l'entonnoir)    |
| 15–25  | Installation de la GitHub App sur les dépôts du système ; connexion Jira et correspondances | connecteur lié ; première preuve (seuil < 15 min) |
| 25–40  | Écran de capture puis tableau de bord : contrôles évalués, échecs expliqués                 | part évaluée automatiquement (seuil ≥ 40 %)       |
| 40–50  | Preuves manuelles et attestations des contrôles restants ; responsables assignés            | contrôles manuels pris en charge                  |
| 50–58  | Premier pack, vérification sur `/verify` et avec `npx @prooflayer/verify`                   | pack vérifiable hors ligne                        |
| 58–60  | Prochaines étapes : point hebdomadaire de 30 minutes, tiers à qui transmettre le pack       | engagement pris                                   |

## Après la session

1. `pnpm partners session <orgId>`.
2. Noter dans le dossier privé du partenaire : blocages rencontrés, questions posées, temps par étape.
3. Quand le partenaire transmet un pack à un tiers réel : `pnpm partners shared <orgId> <client|investor|auditor>`.
4. Chaque semaine : `pnpm partners report`. Un partenaire signalé « À REMPLACER » (GitHub non connecté 14 jours après
   l'ouverture) est remplacé : `pnpm partners replace <orgId>`, puis ouverture d'un nouveau pilote.

## Relevé des quatre métriques du §1.4 (semaine 12)

`pnpm partners report` donne, par partenaire et pour la cohorte active :

1. délai inscription → première preuve capturée (médiane < 15 min) ;
2. part des contrôles applicables évalués automatiquement (médiane ≥ 40 %) ; sinon, plan de pivot du §11.3 ;
3. pack transmis à un tiers réel (≥ 3 partenaires sur 5) ;
4. conversion en payant (≥ 3 sur 5).
