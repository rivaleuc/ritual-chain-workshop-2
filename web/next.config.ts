import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    // @wagmi/connectors reaches @base-org/account through a lazy import that
    // nothing in this app can trigger, but the bundler still walks it and pulls in
    // the Coinbase CDP SDK, the x402 packages and the Solana stack. See the stub.
    resolveAlias: {
      "@base-org/account": "./src/lib/base-account-stub.ts",
    },
  },
};

export default nextConfig;
