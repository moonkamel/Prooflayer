# Pack d'audit de ProofLayer sur lui-même (PL-606, §8.1)

ProofLayer s'inscrit dans son propre registre, se classe avec son propre moteur et publie son propre pack. Le pack
public est produit en production, comme pour tout client, puis désigné par deux variables non secrètes.

## 1. Organisation et fiche

1. Créer en production l'organisation « ProofLayer » (owner : le fondateur, 2FA active).
2. Registre → nouveau système « ProofLayer » :
   - finalité prévue : « Tenir le registre des systèmes d'IA d'une organisation, capturer et sceller les preuves de
     gouvernance depuis GitHub et Jira, exporter un pack d'audit vérifiable » ;
   - rôle : développé en interne ; fournisseur tiers : aucun ; modèles : aucun (MVP) ;
   - catégories de données : identifiants et métadonnées d'activité de comptes professionnels.

## 2. Classification

Questionnaire, d'après le §8.1 (MVP) : le moteur de classification et le moteur de règles appliquent des règles
définies par des personnes, de façon déterministe ; aucun modèle n'intervient (considérant 12, Art. 3(1)).

- « Le système est-il un système d'IA ? » : **non** → règle R1, `NOT_AI_SYSTEM`.
- Signer (nom, fonction, déclaration). La note de classification PDF est jointe au pack.

À la V1 (fonctions génératives) : requalifier le système (risque minimal, Art. 50 et Art. 4), ce qui produit une
nouvelle version signée et un nouveau pack.

## 3. Preuves

- Connecter le dépôt `prooflayer` dès que la GitHub App existe (PL-301) : revues de PR, protection de branche,
  releases alimentent le pack.
- Contrôles manuels du pack A (maîtrise de l'IA, Art. 4) : déposer ou attester les documents.

## 4. Pack et publication

1. Onglet « Packs » → période (par exemple les 90 derniers jours) → générer.
2. Vérifier le pack sur `/verify` puis avec `npx @prooflayer/verify`.
3. Vercel, environnement Production : `PUBLIC_PACK_ORG_ID` (identifiant de l'organisation ProofLayer) et
   `PUBLIC_PACK_ID` (identifiant du pack, visible dans l'adresse de l'écran E). Le centre de confiance `/trust`
   l'affiche aussitôt et `/api/public/pack` le sert.
4. Renouveler chaque trimestre : nouveau pack, nouvelle valeur de `PUBLIC_PACK_ID`.

Seul ce pack devient public : aucune autre donnée de l'organisation n'est lisible par cette voie.
