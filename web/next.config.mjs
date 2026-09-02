/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app imports Phase 1 domain/service/repository code directly from
  // ../src (outside this directory) instead of duplicating it - this tells
  // Next's compiler it's allowed to transpile those files too.
  transpilePackages: [],
  outputFileTracingRoot: process.cwd() + "/..",
  // Explicit, documented equivalent of the previously-deployed image's
  // standalone output. Without this key, this Next.js version only produces
  // .next/standalone when the undocumented NEXT_PRIVATE_STANDALONE env var
  // is set at build time (confirmed in
  // node_modules/next/dist/server/config-shared.js's default config: `output:
  // !!process.env.NEXT_PRIVATE_STANDALONE ? 'standalone' : undefined`) - that
  // must be how the currently-running image was built, since this repo's
  // git history never had `output: "standalone"` in this file. Declaring it
  // here instead makes the build reproducible from source alone. Compatible
  // with outputFileTracingRoot above - standalone tracing honors it and
  // nests the server under .next/standalone/web/ (see deploy/gcp/Dockerfile.web).
  output: "standalone",
  // Don't advertise "X-Powered-By: Next.js" to every response.
  poweredByHeader: false,
  images: {
    // Only the two hosts we've actually observed product images come from
    // (Rakuten's item thumbnail CDN, Coupang's ads-partners CDN). Product
    // photos are hotlinked from these, never re-uploaded/rehosted.
    remotePatterns: [
      { protocol: "https", hostname: "thumbnail.image.rakuten.co.jp" },
      { protocol: "https", hostname: "ads-partners.coupang.com" },
    ],
  },
  // Low-risk headers only - no CSP here yet (see security review notes: a
  // wrong CSP can silently break GA/fonts/images in production, so it needs
  // a Report-Only rollout first, not a blind enforce in this pass). HSTS is
  // also deliberately left out here - it belongs at the TLS-terminating edge
  // (Nginx per deploy/README.md, or the Cloud Run/load-balancer layer if
  // that's actually what's fronting this deployment), once it's confirmed
  // every relevant host is HTTPS-only.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
