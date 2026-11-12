// Chargement du dashboard système : squelette du bandeau et du tableau (§5.3 : « chargement par squelette »).
import { useTranslations } from "next-intl";

export default function Loading() {
  const t = useTranslations("dashboard");
  return (
    <div aria-busy="true" className="space-y-4">
      <p className="sr-only" role="status">
        {t("loading")}
      </p>
      <div className="h-16 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      <div className="h-14 w-full max-w-md animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-10 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      ))}
    </div>
  );
}
