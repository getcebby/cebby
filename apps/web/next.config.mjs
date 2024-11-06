/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ hostname: "**.fbcdn.net" }],
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "events.dorelljames.dev",
          },
        ],
        destination: "https://getcebby.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
