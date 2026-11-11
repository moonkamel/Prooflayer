// Client Better Auth pour les composants de l'interface. Même origine que l'application.
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const TWO_FACTOR_CHALLENGE_PATH = "/two-factor";
export const AFTER_SIGN_IN_PATH = "/account";

// Mot de passe correct et 2FA active : signIn renvoie twoFactorRedirect, traité par le formulaire de connexion.
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });
