// Classifieur public (PL-208) : lien partageable avec réponses préremplies. Fonctions pures, utilisables côté
// navigateur. Les réponses tiennent dans le paramètre `r` (JSON compact en base64url) ; une réponse invalide est
// écartée, jamais interprétée.
import { QUESTION_IDS, isValidResponse, pruneResponses, type Responses } from "./questionnaire";

const toBase64Url = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
};

const fromBase64Url = (value: string) => {
  const binary = atob(value.replace(/-/gu, "+").replace(/_/gu, "/"));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
};

/** Paramètre `r` d'un lien partageable. */
export function encodeResponses(responses: Responses): string {
  return toBase64Url(JSON.stringify(pruneResponses(responses)));
}

/** Réponses d'un lien partageable ; un paramètre absent, illisible ou trop long donne un questionnaire vierge. */
export function decodeResponses(value: string | null | undefined): Responses {
  if (!value || value.length > 2000) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(value));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const responses: Responses = {};
  for (const id of QUESTION_IDS) {
    const answer = (parsed as Record<string, unknown>)[id];
    if (answer !== undefined && isValidResponse(id, answer)) responses[id] = answer;
  }
  return pruneResponses(responses);
}
