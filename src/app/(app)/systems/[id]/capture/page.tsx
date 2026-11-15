// Capture en direct (PL-604, écran 7 du §5.1) : compteur de preuves qui monte, par type, et contrôles qui passent de
// « en attente » à leur statut. Relu toutes les 3 secondes ; « Voir le dashboard » mène à l'écran C.
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { loadSystem } from "../load";
import { LiveCapture } from "./live-capture";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { system } = await loadSystem((await params).id);
  return { title: `${(await getTranslations("capture"))("title")} · ${system.name}` };
}

export default async function CapturePage({ params }: Params) {
  const { api, system } = await loadSystem((await params).id);
  const initial = await api.onboarding.capture({ systemId: system.id });
  return <LiveCapture systemId={system.id} initial={initial} />;
}
