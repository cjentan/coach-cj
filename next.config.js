/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs", "@gooin/garmin-connect"],
  },
};

module.exports = nextConfig;
