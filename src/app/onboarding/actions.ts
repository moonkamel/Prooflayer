"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AFTER_SIGN_IN_PATH } from "@/lib/auth-client";
import { createOrganizationForCurrentUser } from "@/server/services/organization";

const input = z.object({ name: z.string().trim().min(1).max(120) });

export async function createOrganizationAction(form: FormData): Promise<void> {
  const { name } = input.parse({ name: form.get("name") });
  await createOrganizationForCurrentUser(new Headers(await headers()), { name });
  // L'utilisateur est owner : la garde de l'espace connecté le mène d'abord à l'activation de la 2FA.
  redirect(AFTER_SIGN_IN_PATH);
}
