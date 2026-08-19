/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app imports Phase 1 domain/service/repository code directly from
  // ../src (outside this directory) instead of duplicating it - this tells
  // Next's compiler it's allowed to transpile those files too.
  transpilePackages: [],
  outputFileTracingRoot: process.cwd() + "/..",
};

export default nextConfig;
