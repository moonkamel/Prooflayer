import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { STATIC_SECURITY_HEADERS } from "./src/lib/security-headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // En-têtes de sécurité fixes (PL-108) ; la CSP, propre à chaque requête, est posée par src/proxy.ts.
  async headers() {
    return [{ source: "/:path*", headers: STATIC_SECURITY_HEADERS }];
  },
};

export default withNextIntl(nextConfig);
