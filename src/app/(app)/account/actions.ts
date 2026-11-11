"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { revokeOwnOtherSessions, revokeOwnSession } from "@/server/services/session";

const sessionId = z.string().min(1).max(128);

export async function revokeSessionAction(id: string): Promise<void> {
  await revokeOwnSession(sessionId.parse(id));
  revalidatePath("/account");
}

export async function revokeOtherSessionsAction(): Promise<void> {
  await revokeOwnOtherSessions();
  revalidatePath("/account");
}
