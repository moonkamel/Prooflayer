// /.well-known/security.txt (RFC 9116, PL-606) : contact de divulgation des vulnérabilités, lu en configuration
// (LEGAL_SECURITY_EMAIL, à défaut LEGAL_CONTACT_EMAIL). Sans adresse : 404, jamais de contact inventé.
import { legalEntity, securityTxt } from "@/lib/legal";

export const dynamic = "force-dynamic";

export function GET() {
  const body = securityTxt({
    contact: legalEntity(process.env).values.security,
    origin: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    now: new Date(),
  });
  if (!body) return new Response(null, { status: 404 });
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
