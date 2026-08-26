"use client";

import { useState } from "react";

import { CreateMarket } from "@/components/CreateMarket";
import { Header } from "@/components/Header";
import { Markets } from "@/components/Markets";
import { OracleCard } from "@/components/OracleCard";
import { Card } from "@/components/ui";
import { activeChain, explorerAddress, predictAddress } from "@/lib/chain";

export default function Home() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
      <Header />

      {predictAddress ? null : (
        <Card>
          <h2 className="text-lg font-700">Set the contract address</h2>
          <p className="mt-2 text-sm font-500 text-[var(--color-muted)]">
            Deploy with{" "}
            <code className="font-mono">
              cd hardhat &amp;&amp; npx hardhat run scripts/deploy.ts
            </code>
            , then put the address it prints into{" "}
            <code className="font-mono">web/.env.local</code> as
            NEXT_PUBLIC_PREDICT_ADDRESS and restart the dev server.
          </p>
        </Card>
      )}

      <OracleCard />

      <CreateMarket onCreated={() => setRefreshKey((key) => key + 1)} />

      <div className="flex flex-col gap-5">
        <h2 className="text-lg font-700">Markets</h2>
        <Markets refreshKey={refreshKey} />
      </div>

      <footer className="border-t border-[var(--color-border)] pt-6 text-sm font-500 text-[var(--color-muted)]">
        {!predictAddress ? (
          "Not deployed yet."
        ) : explorerAddress(predictAddress) ? (
          <a
            href={explorerAddress(predictAddress)!}
            target="_blank"
            rel="noreferrer"
            className="font-700 text-[var(--color-accent)] underline"
          >
            Contract on the explorer
          </a>
        ) : (
          <span className="font-mono">
            {activeChain.name}, {predictAddress}
          </span>
        )}
      </footer>
    </main>
  );
}
