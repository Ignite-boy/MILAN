/** @type {import("next").NextConfig} */
const nextConfig = {
  turbopack: {
    root: new URL(".", import.meta.url).pathname,
  },

  experimental: {
    optimizePackageImports: ["framer-motion"],
  },

  async rewrites() {
    return [
      {
        source: "/app",
        destination: "/app.html",
      },
    ];
  },

  async headers() {
    return [
      {
        source: "/assets/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
