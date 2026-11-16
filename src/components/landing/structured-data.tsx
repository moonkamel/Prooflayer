// Données structurées schema.org de la page d'accueil (Organization, WebSite, SoftwareApplication, FAQPage). Textes
// tirés des traductions ; prix de la grille du §6.1. Le JSON est échappé (aucun « < » brut dans le script).
import { headers } from "next/headers";

interface Faq {
  q: string;
  a: string;
}

export async function StructuredData(props: {
  url: string;
  name: string;
  description: string;
  faq: Faq[];
}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${props.url}#organization`,
        name: props.name,
        url: props.url,
      },
      {
        "@type": "WebSite",
        "@id": `${props.url}#website`,
        url: props.url,
        name: props.name,
        inLanguage: "en",
        publisher: { "@id": `${props.url}#organization` },
      },
      {
        "@type": "SoftwareApplication",
        name: props.name,
        url: props.url,
        description: props.description,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "EU AI Act compliance software",
        operatingSystem: "Web",
        publisher: { "@id": `${props.url}#organization` },
        offers: {
          "@type": "AggregateOffer",
          priceCurrency: "EUR",
          lowPrice: "3480",
          highPrice: "17880",
          offerCount: 3,
        },
      },
      {
        "@type": "FAQPage",
        mainEntity: props.faq.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  };
  const json = JSON.stringify(graph).replace(/</gu, "\\u003c");
  return (
    <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: json }} />
  );
}
