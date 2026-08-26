"use client";

import { useEffect, useState } from "react";

import { demoOracleUrl, isLocalChain } from "@/lib/chain";
import { Badge, Card, Stat } from "./ui";

type Reading = { price: number; source: string; asOf: string };

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)/;

export function OracleCard() {
  const [reading, setReading] = useState<Reading | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function read() {
      try {
        const response = await fetch("/api/oracle/eth", { cache: "no-store" });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const body = (await response.json()) as Reading;
        if (!cancelled) {
          setReading(body);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "unreachable");
      }
    }

    void read();
    const timer = setInterval(read, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // On a local node the precompiles are mocks, so nothing ever fetches this URL and
  // the warning would be misleading.
  const isLocal = !isLocalChain && LOCAL.test(demoOracleUrl);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-700">Demo oracle</h2>
          <p className="mt-1 max-w-xl text-sm font-500 text-[var(--color-muted)]">
            The endpoint new markets are created against. The contract reads it from
            inside a TEE with the HTTP precompile, then extracts one integer with jq.
          </p>
        </div>
        {reading ? (
          <Badge tone={reading.source === "coinbase" ? "accent" : "neutral"}>
            {reading.source}
          </Badge>
        ) : null}
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-3">
        <Stat
          label="Current reading"
          value={
            error ? (
              <span className="text-[var(--color-no)]">unreachable</span>
            ) : reading ? (
              `$${reading.price.toLocaleString("en-US")}`
            ) : (
              "reading"
            )
          }
        />
        <Stat label="jq path" value={<code className="font-mono">.price</code>} />
        <Stat
          label="Last read"
          value={reading ? new Date(reading.asOf).toLocaleTimeString() : "-"}
        />
      </div>

      <p className="mt-5 break-all rounded-md border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2 font-mono text-xs font-600">
        {demoOracleUrl}
      </p>

      {isLocalChain ? (
        <p className="mt-3 text-sm font-600 text-[var(--color-muted)]">
          Local node: the HTTP and jq precompiles are mocks, so markets resolve against
          whatever hardhat/scripts/local-seed.ts set, not against this endpoint.
        </p>
      ) : null}

      {isLocal ? (
        <p className="mt-3 text-sm font-600 text-[var(--color-no)]">
          This is a localhost URL. The TEE executor runs off-chain and cannot reach it,
          so every resolution attempt will fail and the market will settle Invalid.
          Expose it first, for example with{" "}
          <code className="font-mono">cloudflared tunnel --url http://localhost:3000</code>
          , then set NEXT_PUBLIC_DEMO_ORACLE_URL to the public address.
        </p>
      ) : null}
    </Card>
  );
}
