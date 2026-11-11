// Les quatre rôles du §3.2 E10, déclarés auprès du plugin organization de Better Auth.
//   owner       : tout, dont facturation et suppression
//   admin       : configuration, intégrations, signature, gestion des membres et invitations
//   contributor : preuves manuelles, commentaires, assignations — aucun droit sur l'organisation elle-même
//   auditor     : lecture seule, téléchargement des packs — aucun droit sur l'organisation elle-même
// Les droits métier (preuves, packs…) sont appliqués par withRole dans les procédures tRPC (§4.4.1) ;
// ce contrôle d'accès-ci ne couvre que les opérations d'organisation exécutées par Better Auth.
import { createAccessControl, type AccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, ownerAc } from "better-auth/plugins/organization/access";

const statements = createAccessControl(defaultStatements);

export const owner = statements.newRole(ownerAc.statements);
export const admin = statements.newRole(adminAc.statements);
export const contributor = statements.newRole({});
export const auditor = statements.newRole({});

// Les types génériques conditionnels de Better Auth 1.7.18 ne sont pas assignables à AccessControl sous
// TypeScript 6 (variance de newRole), alors que l'objet est exactement celui qu'attend le plugin.
export const ac = statements as unknown as AccessControl;

export const roles = { owner, admin, contributor, auditor };
