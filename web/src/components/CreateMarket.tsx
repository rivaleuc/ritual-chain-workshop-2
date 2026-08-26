"use client";

import { useEffect, useState } from "react";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";

import { demoOracleUrl, explorerTx, predictAddress } from "@/lib/chain";
import { predictAbi } from "@/lib/predict-abi";
import { COMPARATOR, COMPARATOR_LABEL, DEMO_MARKET, type ComparatorKey } from "@/lib/presets";
import { Button, Card, Field, Input, Select } from "./ui";

export function CreateMarket({ onCreated }: { onCreated: () => void }) {
  const { isConnected } = useAccount();
  const [question, setQuestion] = useState(DEMO_MARKET.question);
  const [target, setTarget] = useState(String(DEMO_MARKET.target));
  const [comparator, setComparator] = useState<ComparatorKey>(DEMO_MARKET.comparator);
  const [bettingSeconds, setBettingSeconds] = useState(String(DEMO_MARKET.bettingSeconds));
  const [resolveDelaySeconds, setResolveDelaySeconds] = useState(
    String(DEMO_MARKET.resolveDelaySeconds),
  );

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: Boolean(hash) },
  });

  useEffect(() => {
    if (!isSuccess) return;
    // The list refetches once, then the receipt state is cleared.
    onCreated();
    reset();
  }, [isSuccess, onCreated, reset]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!predictAddress) return;

    writeContract({
      address: predictAddress,
      abi: predictAbi,
      functionName: "createMarket",
      args: [
        {
          question,
          oracleUrl: demoOracleUrl,
          jsonPath: DEMO_MARKET.jsonPath,
          target: BigInt(target || 0),
          comparator: COMPARATOR[comparator],
          bettingSeconds: BigInt(bettingSeconds || 0),
          resolveDelaySeconds: BigInt(resolveDelaySeconds || 0),
        },
      ],
    });
  }

  const busy = isPending || isConfirming;

  return (
    <Card>
      <h2 className="text-lg font-700">Create a market</h2>
      <p className="mt-1 text-sm font-500 text-[var(--color-muted)]">
        Creating a market also books its own resolution with the Scheduler, in the same
        transaction. Nothing has to remember to settle it afterwards.
      </p>

      <form onSubmit={submit} className="mt-6 grid gap-5">
        <Field label="Question">
          <Input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            required
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Resolves YES when the reading is">
            <Select
              value={comparator}
              onChange={(event) => setComparator(event.target.value as ComparatorKey)}
            >
              {(Object.keys(COMPARATOR) as ComparatorKey[]).map((key) => (
                <option key={key} value={key}>
                  {COMPARATOR_LABEL[key]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Target" hint="Compared against the integer jq extracts.">
            <Input
              type="number"
              min={0}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              required
            />
          </Field>

          <Field label="Betting window (seconds)" hint="Minimum 30.">
            <Input
              type="number"
              min={30}
              value={bettingSeconds}
              onChange={(event) => setBettingSeconds(event.target.value)}
              required
            />
          </Field>

          <Field
            label="Resolve delay (seconds)"
            hint="Gap between the window closing and the first attempt. Minimum 15."
          >
            <Input
              type="number"
              min={15}
              value={resolveDelaySeconds}
              onChange={(event) => setResolveDelaySeconds(event.target.value)}
              required
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!isConnected || !predictAddress || busy}>
            {busy ? "Creating" : "Create market"}
          </Button>
          {!isConnected ? (
            <span className="text-sm font-600 text-[var(--color-muted)]">
              Connect a wallet first.
            </span>
          ) : null}
          {hash && explorerTx(hash) ? (
            <a
              href={explorerTx(hash)!}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-700 text-[var(--color-accent)] underline"
            >
              View transaction
            </a>
          ) : null}
        </div>

        {error ? (
          <p className="text-sm font-600 text-[var(--color-no)]">
            {error.message.split("\n")[0]}
          </p>
        ) : null}
      </form>
    </Card>
  );
}
