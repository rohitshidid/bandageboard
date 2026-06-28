/** @type {import('next').NextConfig} */
const nextConfig = {
  // The `postgres` driver runs only in route handlers (node runtime).
  // Next 14 key name:
  experimental: {
    serverComponentsExternalPackages: ["postgres", "@anthropic-ai/sdk"],
  },
};

export default nextConfig;
