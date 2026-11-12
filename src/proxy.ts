// Proxy Next.js (PL-108) : nonce CSP tiré à chaque requête de page, transmis au rendu (en-tête de requête, lu par
// Next.js pour ses propres scripts) et posé sur la réponse. Les pages sont rendues dynamiquement.
import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, storageOrigin } from "@/lib/security-headers";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, {
    dev: process.env.NODE_ENV === "development",
    connect: [storageOrigin(process.env.S3_ENDPOINT)],
  });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages seulement : ni API, ni fichiers statiques, ni préchargements de liens.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
