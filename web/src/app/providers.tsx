"use client";

import { RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";

import { ritualChain } from "@/lib/chain";

import "@rainbow-me/rainbowkit/styles.css";

// getDefaultConfig wires up injected wallets, MetaMask and WalletConnect together.
// The project id is optional here: without it injected wallets still connect.
const config = getDefaultConfig({
  appName: "Ritual Predict",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "ritual-predict-demo",
  chains: [ritualChain],
  ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {/* initialChain makes the wallet switch to Ritual on connect. */}
        <RainbowKitProvider initialChain={ritualChain}>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
