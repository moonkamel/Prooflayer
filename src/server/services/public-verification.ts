// Page publique de vérification (PL-508, §4.4.1 : sans authentification, données publiques par construction). Le pack
// est vérifié dans le navigateur et ne quitte jamais le poste ; le serveur ne fournit que la confiance : clés publiques
// de signature (épinglées dans @prooflayer/verify, et celles que ProofLayer publie sur /.well-known) et racines des
// prestataires d'horodatage (épinglées, et celle du prestataire configuré en production).
import { PINNED_KEYS, PINNED_TSA_ROOTS, type TrustedRoot } from "@prooflayer/verify";
import { publishedSigningKeys } from "@/server/system/signing-keys";

export interface VerificationTrust {
  keys: Record<string, string>;
  tsaRoots: TrustedRoot[];
}

export async function verificationTrust(
  env: Record<string, string | undefined> = process.env,
): Promise<VerificationTrust> {
  const published = await publishedSigningKeys(env);
  const keys: Record<string, string> = { ...PINNED_KEYS };
  for (const k of published) keys[k.kid] ??= k.publicKey;
  const tsaRoots = [...PINNED_TSA_ROOTS];
  if (env.TSA_URL && env.TSA_TRUST_PEM) {
    tsaRoots.push({
      name: env.TSA_NAME ?? new URL(env.TSA_URL).hostname,
      qualified: env.TSA_QUALIFIED === "true",
      pem: env.TSA_TRUST_PEM,
    });
  }
  return { keys, tsaRoots };
}
