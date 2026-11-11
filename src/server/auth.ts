// Authentification (PL-103, §4.2, §4.7) : Better Auth, sessions en base, mots de passe hachés en scrypt (défaut).
// Email et mot de passe avec vérification d'adresse, réinitialisation, Google (OIDC) si configuré, 2FA TOTP.
// PL-104 : organisations, invitations par email (7 jours, révocables) et les quatre rôles du §3.2 E10.
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { organization, twoFactor } from "better-auth/plugins";
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/config";
import { ac, roles } from "./auth-roles";
import { audit } from "./services/audit";
import { renderInvitationEmail, sendAuthEmail } from "./email/auth-emails";
import { createEmailTransport } from "./email/transport";
import { authDatabase } from "./system/auth-database";
import { firstOrganizationIdOf } from "./system/identity";

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
  database: authDatabase,

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
    session: {
      create: {
        // Toute nouvelle session s'ouvre sur une organisation du membre, s'il en a une.
        before: async (session) => {
          const s = session as typeof session & { activeOrganizationId?: string | null };
          if (s.activeOrganizationId) return;
          const organizationId = await firstOrganizationIdOf(session.userId);
          if (!organizationId) return;
          return { data: { ...session, activeOrganizationId: organizationId } };
        },
      },
    },
  },

  plugins: [
    twoFactor({ issuer: "ProofLayer", backupCodeOptions: { amount: 10 } }),
    organization({
      ac,
      roles,
      creatorRole: "owner",
      invitationExpiresIn: 7 * 24 * 60 * 60, // 7 jours (§3.2 E10)
      cancelPendingInvitationsOnReInvite: true,
      requireEmailVerificationOnInvitation: true,
      // Journal d'audit (PL-106) des écritures faites directement auprès de Better Auth, sans service intermédiaire.
      organizationHooks: {
        afterCreateOrganization: async ({ organization, user }) => {
          await audit(
            { orgId: organization.id, actor: { type: "user", id: user.id } },
            "organization.create",
            { type: "organization", id: organization.id },
            { name: organization.name },
          );
        },
        afterAcceptInvitation: async ({ invitation, member, user, organization }) => {
          await audit(
            { orgId: organization.id, actor: { type: "user", id: user.id } },
            "invitation.accept",
            { type: "invitation", id: invitation.id },
            { memberId: member.id, role: member.role },
          );
        },
      },
      sendInvitationEmail: async ({ id, email, organization, inviter, role }) => {
        const base = process.env.BETTER_AUTH_URL ?? "";
        await transport().send(
          await renderInvitationEmail({
            to: email,
            organization: organization.name,
            inviter: inviter.user.name,
            role,
            url: `${base}/accept-invitation/${encodeURIComponent(id)}`,
            locale: (inviter.user as { locale?: unknown }).locale,
          }),
        );
      },
    }),
    // Doit rester le dernier plugin : pose les cookies de session depuis les actions serveur.
    nextCookies(),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
