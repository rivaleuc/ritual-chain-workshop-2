"use client";

import { useCallback } from "react";
import { useBlockNumber, useReadContract } from "wagmi";

import { predictAddress } from "@/lib/chain";
import { predictAbi } from "@/lib/predict-abi";
import type { Market } from "@/lib/presets";
import { MarketCard } from "./MarketCard";
import { Card } from "./ui";

export function Markets({ refreshKey }: { refreshKey: number }) {
  const { data: blockNumber } = useBlockNumber({ watch: true });

  const { data, refetch, isLoading, error } = useReadContract({
    address: predictAddress || undefined,
    abi: predictAbi,
    functionName: "getMarkets",
    query: {
      enabled: Boolean(predictAddress),
      // Markets close and resolve on their own, so the list has to keep up.
      refetchInterval: 5_000,
    },
  });

  const onChanged = useCallback(() => {
    void refetch();
  }, [refetch]);

  // Bumping refreshKey after a creation pulls the new market in immediately.
  void refreshKey;

  const markets = (data ?? []) as readonly Market[];

  if (error) {
    return (
      <Card>
        <p className="text-sm font-600 text-[var(--color-no)]">
          Could not read the contract: {error.message.split("\n")[0]}
        </p>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <p className="text-sm font-600 text-[var(--color-muted)]">Loading markets.</p>
      </Card>
    );
  }

  if (markets.length === 0) {
    return (
      <Card>
        <p className="text-sm font-600 text-[var(--color-muted)]">
          No markets yet. Create the first one above.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid gap-5">
      {markets.map((market) => (
        <MarketCard
          key={market.id.toString()}
          market={market}
          blockNumber={blockNumber}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}
