// Lecture de la fiche pour la coque et les onglets : une fiche absente ou d'une autre organisation donne une 404.
import { notFound } from "next/navigation";
import { cache } from "react";
import { TRPCError } from "@trpc/server";
import { serverCaller } from "@/server/caller";

export const loadSystem = cache(async (id: string) => {
  const api = await serverCaller();
  try {
    return { api, system: await api.system.get({ id }) };
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
});
