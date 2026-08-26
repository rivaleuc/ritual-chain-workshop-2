/**
 * Shared plumbing for the local-node scripts.
 *
 * Ritual Chain is not reachable, so the system contracts and precompiles are stood up
 * as mocks and installed at their canonical addresses with `hardhat_setCode`. That
 * keeps RitualPredict byte-for-byte the contract that gets deployed: it still calls
 * 0x0801, 0x0803, the Scheduler and the RitualWallet by their real addresses. The only
 * thing being faked is what answers.
 *
 * Requires `npx hardhat node` running in another terminal.
 */
import { network } from "hardhat";
import { encodeFunctionData, parseEther, toHex, type Address } from "viem";

import { COMPARATOR } from "./market-presets.ts";
import { RITUAL } from "./ritual.ts";

/** Matches the measured Ritual Chain block time, so durations convert realistically. */
export const BLOCK_TIME_MS = 195n;

/** MockHttpPrecompile.Mode. */
export const HTTP_MODE = { Ok: 0, Reverts: 1, Garbage: 2, Unsettled: 3 } as const;

export const STATE_LABEL = ["Open", "Closed", "Resolving", "Resolved", "Invalid"];
export const OUTCOME_LABEL = ["Unresolved", "YES", "NO"];

/** A stand-in TEE executor address. Nothing runs behind it; the mock answers. */
export const EXECUTOR = "0x000000000000000000000000000000000000ee50" as Address;

/**
 * The subset of MockScheduler.Booking the scripts read. `getContractAt` is called with
 * a contract name that is not a literal here, so its return is loosely typed.
 */
export type SchedulerBooking = {
  numCalls: number;
  frequency: number;
  startBlock: number;
  payer: `0x${string}`;
};

export type NewMarketArgs = {
  question: string;
  oracleUrl: string;
  jsonPath: string;
  target: bigint;
  comparator: number;
  bettingSeconds: bigint;
  resolveDelaySeconds: bigint;
};

export async function connectLocalChain() {
  const connection = await network.create({
    network: "localhost",
    chainType: "l1",
  });
  const { viem, networkHelpers, provider } = connection;
  const publicClient = await viem.getPublicClient();
  const wallets = await viem.getWalletClients();

  const [deployer, alice, bob] = wallets;
  if (deployer === undefined || alice === undefined || bob === undefined) {
    throw new Error(
      "Expected at least three unlocked accounts. Is `npx hardhat node` running?",
    );
  }

  async function install(contractName: string, at: Address) {
    const deployed = await viem.deployContract(contractName);
    const code = await publicClient.getCode({ address: deployed.address });
    if (code === undefined) throw new Error(`${contractName} has no runtime code`);
    await provider.request({ method: "hardhat_setCode", params: [at, code] });
    return viem.getContractAt(contractName, at);
  }

  const scheduler = await install("MockScheduler", RITUAL.scheduler);
  await install("MockRitualWallet", RITUAL.ritualWallet);
  const registry = await install("MockTEERegistry", RITUAL.teeServiceRegistry);
  const http = await install("MockHttpPrecompile", RITUAL.httpPrecompile);
  const jq = await install("MockJqPrecompile", RITUAL.jqPrecompile);

  await registry.write.setExecutors([[EXECUTOR]]);

  const predict = await viem.deployContract("RitualPredict", [BLOCK_TIME_MS]);

  // The Scheduler is just an unlocked account as far as the local node is concerned.
  await networkHelpers.impersonateAccount(RITUAL.scheduler);
  await networkHelpers.setBalance(RITUAL.scheduler, parseEther("100"));

  /** Point the mock oracle at a value, the way a live endpoint would answer. */
  async function setOracle(price: bigint, body = `{"price":${price}}`) {
    await http.write.setMode([HTTP_MODE.Ok]);
    await http.write.setOk([200, toHex(body)]);
    await jq.write.setValue([price]);
  }

  /** Take the oracle offline so every read fails. */
  async function breakOracle() {
    await http.write.setMode([HTTP_MODE.Reverts]);
  }

  async function createMarket(args: NewMarketArgs) {
    const hash = await predict.write.createMarket([args]);
    await publicClient.waitForTransactionReceipt({ hash });
    return predict.read.marketCount();
  }

  async function bet(
    who: typeof alice,
    marketId: bigint,
    isYes: boolean,
    amount: string,
  ) {
    const hash = await predict.write.bet([marketId, isYes], {
      account: who.account,
      value: parseEther(amount),
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  /** Fire one scheduled execution exactly as the Scheduler would. */
  async function fire(executionIndex: bigint, marketId: bigint) {
    const hash = (await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: RITUAL.scheduler,
          to: predict.address,
          gas: toHex(5_000_000),
          data: encodeFunctionData({
            abi: predict.abi,
            functionName: "onScheduledResolve",
            args: [executionIndex, marketId],
          }),
        },
      ],
    })) as `0x${string}`;
    return publicClient.waitForTransactionReceipt({ hash });
  }

  async function mineToBlock(target: bigint) {
    const current = await publicClient.getBlockNumber();
    if (target > current) await networkHelpers.mine(Number(target - current));
  }

  async function mineToResolveBlock(marketId: bigint) {
    const { resolveBlock } = await predict.read.getMarket([marketId]);
    await mineToBlock(resolveBlock);
  }

  async function mineToCloseBlock(marketId: bigint) {
    const { closeBlock } = await predict.read.getMarket([marketId]);
    await mineToBlock(closeBlock);
  }

  /** Burn all three booked attempts against an oracle that never answers. */
  async function exhaustAttempts(marketId: bigint) {
    const retryInterval = await predict.read.RETRY_INTERVAL_BLOCKS();
    await mineToResolveBlock(marketId);
    for (let attempt = 0n; attempt < 3n; attempt++) {
      await fire(attempt, marketId);
      if (attempt < 2n) await networkHelpers.mine(Number(retryInterval));
    }
  }

  return {
    connection,
    provider,
    publicClient,
    networkHelpers,
    deployer,
    alice,
    bob,
    predict,
    scheduler,
    registry,
    http,
    jq,
    setOracle,
    breakOracle,
    createMarket,
    bet,
    fire,
    mineToBlock,
    mineToCloseBlock,
    mineToResolveBlock,
    exhaustAttempts,
  };
}

/** A market preset with the durations already converted to the right shape. */
export function marketArgs(
  question: string,
  target: bigint,
  oracleUrl: string,
  bettingSeconds = 120n,
  resolveDelaySeconds = 30n,
): NewMarketArgs {
  return {
    question,
    oracleUrl,
    jsonPath: ".price",
    target,
    comparator: COMPARATOR.gte,
    bettingSeconds,
    resolveDelaySeconds,
  };
}
