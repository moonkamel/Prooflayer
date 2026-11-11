import type { ReactNode } from "react";
import { requireSession } from "@/server/services/session";

// Espace connecté : session obligatoire, 2FA obligatoire pour owner et admin (PL-103).
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return <>{children}</>;
}
