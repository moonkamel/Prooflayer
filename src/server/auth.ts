// Authentification (PL-103, §4.2, §4.7) : Better Auth, sessions en base, mots de passe hachés en scrypt (défaut).
// Email et mot de passe avec vérification d'adresse, réinitialisation, Google (OIDC) si configuré, 2FA TOTP.
// Les organisations et les invitations (plugin organization) arrivent avec PL-104.
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/config";
import { sendAuthEmail } from "./email/auth-emails";
import { createEmailTransport } from "./email/transport";
import { prisma } from "./db";

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
/** La connexion Google n'apparaît que si le client OAuth est configuré. */
export const googleEnabled = Boolean(googleClientId && googleClientSecret);

// Créé à la première utilisation : un transport absent ne bloque ni le build ni les pages sans email.
const transport = () => createEmailTransport();

function cookieValue(cookieHeader: string | null | undefined, name: string): string | undefined {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export const auth = betterAuth({
  appName: "ProofLayer",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),

  user: {
    additionalFields: {
      // Langue des emails et de l'interface (§5.2). Fixée à l'inscription, jamais fournie par le client.
      locale: { type: "string", required: false, defaultValue: "fr", input: false },
    },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmail(transport(), "resetPassword", user, url);
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail(transport(), "verify", user, url);
    },
  },

  socialProviders:
    googleClientId && googleClientSecret
      ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } }
      : {},

  databaseHooks: {
    user: {
      create: {
        // Langue du compte : celle choisie dans l'interface au moment de l'inscription.
        before: async (user, context) => {
          const headers = context?.headers;
          const locale = resolveLocale(
            cookieValue(headers?.get("cookie"), LOCALE_COOKIE),
            headers?.get("accept-language") ?? null,
          );
          return { data: { ...user, locale } };
        },
      },
    },
  },

  plugins: [
    twoFactor({ issuer: "ProofLayer", backupCodeOptions: { amount: 10 } }),
    // Doit rester le dernier plugin : pose les cookies de session depuis les actions serveur.
    nextCookies(),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
