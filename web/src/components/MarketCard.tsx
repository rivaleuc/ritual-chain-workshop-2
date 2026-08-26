"use client";

import { useState } from "react";
import { parseEther } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { explorerTx, predictAddress } from "@/lib/chain";
import { blocksAway, ritual, shortAddress, yesShare } from "@/lib/format";
import { predictAbi } from "@/lib/predict-abi";
import { COMPARATOR_LABEL, MARKET_STATE, OUTCOME, type ComparatorKey, type Market } from "@/lib/presets";
import { Badge, Button, Card, Input, Label, Stat } from "./ui";

const COMPARATOR_KEYS: ComparatorKey[] = ["gt", "gte", "lt", "lte"];

function stateTone(state: number) {
  if (state === 3) return "accent" as const;
  if (state === 4) return "no" as const;
  return "neutral" as const;
}

export function MarketCard({
  market,
  blockNumber,
  onChanged,
}: {
  market: Market;
  blockNumber: bigint | undefined;
  onChanged: () => void;
}) {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState("0.01");

  const { data: stakes, refetch: refetchStakes } = useReadContract({
    address: predictAddress || undefined,
    abi: predictAbi,
    functionName: "stakesOf",
    args: address ? [market.id, address] : undefined,
    query: { enabled: Boolean(predictAddress && address) },
  });

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: Boolean(hash) },
  });

  async function afterTx() {
    await Promise.all([refetchStakes(), Promise.resolve(onChanged())]);
    reset();
  }

  function bet(isYes: boolean) {
    if (!predictAddress) return;
    writeContract(
      {
        address: predictAddress,
        abi: predictAbi,
        functionName: "bet",
        args: [market.id, isYes],
        value: parseEther(amount || "0"),
      },
      { onSuccess: () => void afterTx() },
    );
  }

  function settle(fn: "claimWinnings" | "claimRefund") {
    if (!predictAddress) return;
    writeContract(
      {
        address: predictAddress,
        abi: predictAbi,
        functionName: fn,
        args: [market.id],
      },
      { onSuccess: () => void afterTx() },
    );
  }

  const [yesStake, noStake, alreadySettled, claimable] = (stakes ?? [
    0n,
    0n,
    false,
    0n,
  ]) as readonly [bigint, bigint, boolean, bigint];

  const pool = market.totalYes + market.totalNo;
  const share = yesShare(market.totalYes, market.totalNo);
  const busy = isPending || isConfirming;

  const isOpen = market.state === 0;
  const isResolved = market.state === 3;
  const isInvalid = market.state === 4;
  const hasStake = yesStake > 0n || noStake > 0n;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>#{market.id.toString()}</Badge>
            <Badge tone={stateTone(market.state)}>{MARKET_STATE[market.state]}</Badge>
            {isResolved ? (
              <Badge tone={market.outcome === 1 ? "yes" : "no"}>
                {OUTCOME[market.outcome]}
              </Badge>
            ) : null}
          </div>
          <h3 className="mt-3 text-base font-700">{market.question}</h3>
          <p className="mt-1 text-sm font-500 text-[var(--color-muted)]">
            Resolves YES when the reading is{" "}
            {COMPARATOR_LABEL[COMPARATOR_KEYS[market.comparator]]}{" "}
            {market.target.toString()}. Created by {shortAddress(market.creator)}.
          </p>
        </div>
      </div>

      {/* pool split */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <Label>Pool {ritual(pool)}</Label>
          <span className="text-xs font-700 text-[var(--color-muted)]">
            {share === null ? "no stakes yet" : `${share}% YES`}
          </span>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-md bg-[var(--color-border)]">
          <div
            className="bg-[var(--color-yes)]"
            style={{ width: `${share ?? 0}%` }}
            aria-hidden
          />
          <div
            className="bg-[var(--color-no)]"
            style={{ width: `${share === null ? 0 : 100 - share}%` }}
            aria-hidden
          />
        </div>
        <div className="mt-2 flex justify-between text-xs font-600 text-[var(--color-muted)]">
          <span>YES {ritual(market.totalYes)}</span>
          <span>NO {ritual(market.totalNo)}</span>
        </div>
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-3">
        <Stat
          label="Betting closes"
          value={
            blockNumber
              ? (blocksAway(market.closeBlock, blockNumber) ?? "closed")
              : `block ${market.closeBlock}`
          }
        />
        <Stat
          label="First attempt"
          value={
            blockNumber
              ? (blocksAway(market.resolveBlock, blockNumber) ?? "due")
              : `block ${market.resolveBlock}`
          }
        />
        <Stat label="Attempts used" value={`${market.attempts} of 3`} />
      </div>

      {isResolved || isInvalid ? (
        <div className="mt-5 rounded-md border border-[var(--color-border)] bg-[var(--color-canvas)] px-4 py-3 text-sm font-600">
          {isResolved
            ? `Observed ${market.observedValue.toString()}, settled ${OUTCOME[market.outcome]}.`
            : `Invalid: ${market.invalidReason}. Every stake is refundable.`}
        </div>
      ) : null}

      {/* actions */}
      <div className="mt-6 border-t border-[var(--color-border)] pt-5">
        {isOpen ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-36">
              <Label>Stake</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="mt-1.5"
              />
            </div>
            <Button tone="yes" disabled={!isConnected || busy} onClick={() => bet(true)}>
              Bet YES
            </Button>
            <Button tone="no" disabled={!isConnected || busy} onClick={() => bet(false)}>
              Bet NO
            </Button>
          </div>
        ) : isResolved && claimable > 0n && !alreadySettled ? (
          <Button disabled={busy} onClick={() => settle("claimWinnings")}>
            Claim {ritual(claimable)}
          </Button>
        ) : isInvalid && claimable > 0n && !alreadySettled ? (
          <Button tone="quiet" disabled={busy} onClick={() => settle("claimRefund")}>
            Refund {ritual(claimable)}
          </Button>
        ) : (
          <p className="text-sm font-600 text-[var(--color-muted)]">
            {alreadySettled
              ? "Already settled."
              : hasStake
                ? "Waiting for the Scheduler to wake the contract."
                : "Betting is closed."}
          </p>
        )}

        {hasStake ? (
          <p className="mt-3 text-xs font-600 text-[var(--color-muted)]">
            Your stake: {ritual(yesStake)} YES, {ritual(noStake)} NO
          </p>
        ) : null}

        {hash ? (
          <a
            href={explorerTx(hash)}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-sm font-700 text-[var(--color-accent)] underline"
          >
            View transaction
          </a>
        ) : null}

        {error ? (
          <p className="mt-3 text-sm font-600 text-[var(--color-no)]">
            {error.message.split("\n")[0]}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
