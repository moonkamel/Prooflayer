// Appel des procédures tRPC depuis les composants serveur, avec la même garde que par HTTP.
import { headers } from "next/headers";
import { createContext } from "./context";
import { createCaller } from "./routers/_app";

export async function serverCaller() {
  return createCaller(await createContext(new Headers(await headers())));
}
