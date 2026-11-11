import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";

// Région fra1 : fixée dans la configuration Vercel (PL-108), l'option de segment preferredRegion étant dépréciée.
export const runtime = "nodejs";

export const { GET, POST } = toNextJsHandler(auth);
