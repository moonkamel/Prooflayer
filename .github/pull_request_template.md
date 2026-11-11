## Ticket

<!-- Identifiant et titre, par exemple : PL-101 — Initialiser le dépôt et la CI -->

## Ce qui change

<!-- Deux ou trois phrases. Citer les sections du cahier des charges concernées (§…). -->

## Liste de contrôle (Definition of Done, §9.1)

- [ ] `pnpm typecheck && pnpm lint && pnpm test` passent en local
- [ ] Tests écrits avant le code pour : classification, règles, cryptographie, isolation, webhooks
- [ ] Test d'étanchéité entre organisations vert (dès PL-105)
- [ ] Toute migration a son retour arrière, et `pnpm db:validate` passe
- [ ] Déployé en prévisualisation (dès PL-108)
- [ ] Aucune chaîne visible en dur : tout passe par `messages/{fr,en}.json`
- [ ] Le mot « conforme » n'apparaît nulle part dans l'interface
- [ ] Toute action d'écriture est inscrite au journal d'audit
- [ ] Aucun secret, jeton ni charge brute dans les journaux, les tests ou Sentry
- [ ] Accès aux données métier uniquement via `forOrg(orgId)` ; aucune logique métier dans un routeur ou un route handler
- [ ] Aucun LLM dans une décision de classification ou d'évaluation
- [ ] `CLAUDE.md` mis à jour si une convention change
- [ ] Aucune contradiction avec `docs/cahier-des-charges.md`, ou contradiction signalée ci-dessous

## Écarts avec le cahier des charges

<!-- « Aucun », ou la liste des écarts et leur justification. -->
