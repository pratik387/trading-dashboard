/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // /historical was split into per-book History tabs (Intraday /
      // Overnight / Multiday). Send old links home.
      {
        source: "/historical",
        destination: "/",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/:path*",
      },
    ];
  },
};

export default nextConfig;
