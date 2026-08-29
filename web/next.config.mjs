/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app imports Phase 1 domain/service/repository code directly from
  // ../src (outside this directory) instead of duplicating it - this tells
  // Next's compiler it's allowed to transpile those files too.
  transpilePackages: [],
  outputFileTracingRoot: process.cwd() + "/..",
  // Self-contained server bundle for Docker/Cloud Run - traces the actual
  // resolved node_modules (including root's, per outputFileTracingRoot
  // above) rather than requiring a full `npm ci` + repo checkout at
  // runtime. See deploy/gcp/Dockerfile.web.
  output: "standalone",
  images: {
    // Only the two hosts we've actually observed product images come from
    // (Rakuten's item thumbnail CDN, Coupang's ads-partners CDN). Product
    // photos are hotlinked from these, never re-uploaded/rehosted.
    remotePatterns: [
      { protocol: "https", hostname: "thumbnail.image.rakuten.co.jp" },
      { protocol: "https", hostname: "ads-partners.coupang.com" },
    ],
  },
};

export default nextConfig;
