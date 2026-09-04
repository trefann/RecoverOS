/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@recoveros/shared"],
  webpack: (config) => {
    // @recoveros/shared is consumed as raw TS source (no build step) and
    // uses Node/NodeNext-style relative imports ("./constants.js" pointing
    // at constants.ts, required for apps/api's ESM runtime). Webpack's
    // default resolver looks for a literal .js file and fails, so teach it
    // to also try .ts/.tsx for a ".js" specifier.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
