/** @type {import('next').NextConfig} */

const createNextIntlPlugin = require("next-intl/plugin");
const withNextIntl = createNextIntlPlugin();

const nextConfig = {
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs", "@gooin/garmin-connect"],
    // @gooin/garmin-connect uses obfuscated code where require paths are
    // dynamically constructed — the static analyzer can't trace them, so the
    // subdirectories (garmin/, common/) get dropped from the standalone output.
    // Force-include the entire package to avoid MODULE_NOT_FOUND at runtime.
    outputFileTracingIncludes: {
      "/api/**": ["./node_modules/@gooin/garmin-connect/**/*"],
    },
  },
};

module.exports = withNextIntl(nextConfig);
