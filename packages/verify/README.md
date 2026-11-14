# @prooflayer/verify

Vérifie **hors ligne**, sans compte ProofLayer et sans réseau, un pack d'audit exporté par ProofLayer.

```sh
npx @prooflayer/verify pack.zip
```

Code de sortie `0` : aucune altération. Code `1` : échec de la vérification, archive illisible ou options invalides.

## Ce que l'outil vérifie

1. **Signature du manifeste.** Ed25519, avec une clé publique épinglée dans l'outil, jamais téléchargée. L'outil vérifie aussi l'empreinte SHA-256 de chaque fichier, et qu'aucun fichier n'a été ajouté.
2. **Preuves divulguées.** Il recalcule `contentSha256 = SHA-256(JCS(payload))` (RFC 8785) et `leafHash = SHA-256(0x00 ‖ sel ‖ JCS(enveloppe))`. La feuille obtenue doit être celle de la place indiquée dans le lot. Il vérifie aussi l'empreinte des pièces jointes.
3. **Lots.** La racine de Merkle (RFC 6962) de toutes les feuilles du lot doit être celle de l'en-tête. Il recalcule le `batchHash` et la continuité de la chaîne (`seq` sans trou, `prevBatchHash`).
4. **Ancres.** Chaque `batchHash` doit être inclus dans son ancre. Il recalcule la racine et l'`anchorHash`.
5. **Horodatage RFC 3161.** Le jeton doit horodater l'`anchorHash`, porter une signature CMS valide et un signataire à usage d'horodatage. Sa chaîne doit remonter à une racine de prestataire épinglée dans l'outil. Les racines jointes au pack ne sont jamais crues.
6. **Recensement.** Il compte les feuilles de la période, les preuves divulguées et l'écart, et compare ces décomptes à ceux du manifeste.

Exemple de sortie : « 214 preuves vérifiées, scellées entre le 4 décembre 2026 et le 3 mars 2027, 0 altération, 12 preuves de la période non divulguées ».

Des avertissements, sans altération, signalent ce que la vérification ne peut pas établir. Par exemple : un lot pas encore horodaté par un tiers, un prestataire d'horodatage non qualifié eIDAS, ou une pièce jointe scellée mais non jointe. Avec `--strict`, ces avertissements font aussi échouer la vérification.

## Options

| Option                       | Effet                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `--json`                     | Sortie JSON (rapport complet, par étape)                                      |
| `--lang fr\|en`              | Langue de la sortie (par défaut : celle du pack)                              |
| `--strict`                   | Les avertissements font échouer la vérification                               |
| `--trust-key <kid>=<base64>` | Ajoute une clé publique Ed25519, par exemple celle d'un environnement de test |
| `--trust-tsa <fichier.pem>`  | Ajoute une racine de prestataire d'horodatage, réputée non qualifiée          |

## Ce que le scellement prouve, et ce qu'il ne prouve pas

Le scellement prouve trois choses : le contenu d'une preuve existait au plus tard à la date du jeton et n'a pas changé depuis ; aucune preuve n'a été retirée d'un lot ; l'ordre des lots est intact.

Il ne prouve pas que l'événement s'est produit dans l'outil source : chaque preuve porte l'adresse de sa source pour contre-vérification. Une preuve déclarative (document déposé, attestation) date le dépôt, pas la véracité du document.

## Sans cet outil

Le fichier `VERIFY.md` de chaque pack décrit la même vérification avec `openssl ts -verify` et `sha256sum`.

## API

```ts
import { verifyPack, formatReport } from "@prooflayer/verify";

const report = await verifyPack(zipBytes); // clés et racines épinglées par défaut
console.log(formatReport(report, "fr"));
```

Le cœur n'utilise que WebCrypto, `fflate`, `pkijs` et `asn1js`. Il s'exécute dans Node 20 et plus, comme dans un navigateur récent.

## Licence

MIT.
