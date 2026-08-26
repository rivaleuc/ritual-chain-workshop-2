/**
 * End-to-end walkthroughs of the workshop flow, driven the way a user or a script
 * would drive it: deploy, create a market, bet from two accounts, let the Scheduler
 * wake the contract, then settle up.
 *
 * The Ritual system contracts and precompiles are stood up as mocks and installed at
 * their canonical addresses with `hardhat_setCode`, so `RitualPredict` runs unmodified
 * against a plain local node.
 *
 * The unit-level assertions live in contracts/RitualPredict.t.sol. These two tests
 * exist to prove the pieces fit together across a whole market lifecycle.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { encodeFunctionData, parseEther, toHex, type Address } from "viem";

import { COMPARATOR } from "../scripts/market-presets.ts";
import { RITUAL } from "../scripts/ritual.ts";

const BLOCK_TIME_MS = 195n;
const BETTING_SECONDS = 60n;
const RESOLVE_DELAY_SECONDS = 30n;

const ORACLE_URL = "http://localhost:3000/api/oracle/eth";
const JSON_PATH = ".price";

/** MarketState, matching RitualPredict.MarketState. */
const STATE = { Open: 0, Closed: 1, Resolving: 2, Resolved: 3, Invalid: 4 } as const;
/** Outcome, matching RitualPredict.Outcome. */
const OUTCOME = { Unresolved: 0, Yes: 1, No: 2 } as const;
/** MockHttpPrecompile.Mode. */
const HTTP_MODE = { Ok: 0, Reverts: 1, Garbage: 2, Unsettled: 3 } as const;

/** The subset of MockScheduler.Booking these tests assert on. */
type SchedulerBooking = {
  numCalls: number;
  startBlock: number;
  payer: Address;
};

async function setUpChain() {
  const connection = await network.create({
    network: "hardhatMainnet",
    chainType: "l1",
  });
  const { viem, networkHelpers, provider } = connection;
  const publicClient = await viem.getPublicClient();
  const [deployer, alice, bob] = await viem.getWalletClients();

  // Deploy each mock normally, then copy its runtime code to the canonical address
  // the contract under test actually calls.
  async function install<Name extends string>(contractName: Name, at: Address) {
    const deployed = await viem.deployContract(contractName);
    const code = await publicClient.getCode({ address: deployed.address });
    assert.ok(code, `${contractName} has no runtime code`);
    await provider.request({ method: "hardhat_setCode", params: [at, code] });
    return viem.getContractAt(contractName, at);
  }

  const scheduler = await install("MockScheduler", RITUAL.scheduler);
  await install("MockRitualWallet", RITUAL.ritualWallet);
  const registry = await install("MockTEERegistry", RITUAL.teeServiceRegistry);
  const http = await install("MockHttpPrecompile", RITUAL.httpPrecompile);
  const jq = await install("MockJqPrecompile", RITUAL.jqPrecompile);

  // One registered HTTP executor, and a healthy oracle answering 4200.
  const executor = "0x000000000000000000000000000000000000ee50" as Address;
  await registry.write.setExecutors([[executor]]);
  await http.write.setOk([200, toHex('{"price":4200}')]);
  await jq.write.setValue([4200n]);

  const predict = await viem.deployContract("RitualPredict", [BLOCK_TIME_MS]);

  // The Scheduler is an EOA as far as the local node is concerned.
  await networkHelpers.impersonateAccount(RITUAL.scheduler);
  await networkHelpers.setBalance(RITUAL.scheduler, parseEther("100"));

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

  /** Mine forward until the market's first resolution attempt is due. */
  async function mineToResolveBlock(marketId: bigint) {
    const { resolveBlock } = await predict.read.getMarket([marketId]);
    const current = await publicClient.getBlockNumber();
    if (resolveBlock > current) {
      await networkHelpers.mine(Number(resolveBlock - current));
    }
  }

  async function createDemoMarket(question: string, target: bigint) {
    const hash = await predict.write.createMarket([
      {
        question,
        oracleUrl: ORACLE_URL,
        jsonPath: JSON_PATH,
        target,
        comparator: COMPARATOR.gte,
        bettingSeconds: BETTING_SECONDS,
        resolveDelaySeconds: RESOLVE_DELAY_SECONDS,
      },
    ]);
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
    return publicClient.waitForTransactionReceipt({ hash });
  }

  return {
    connection,
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
    executor,
    fire,
    mineToResolveBlock,
    createDemoMarket,
    bet,
  };
}

describe("RitualPredict end to end", () => {
  it("settles itself from the Scheduler callback and pays the winners", async () => {
    const t = await setUpChain();

    // ── prepay execution fees, the way scripts/deploy.ts does ──
    const fundHash = await t.predict.write.fundExecution([500_000n], {
      value: parseEther("0.5"),
    });
    await t.publicClient.waitForTransactionReceipt({ hash: fundHash });
    assert.equal(await t.predict.read.executionBalance(), parseEther("0.5"));

    // ── create ──
    const marketId = await t.createDemoMarket(
      "Will ETH/USD be at least $4,000 when this market resolves?",
      4_000n,
    );
    assert.equal(marketId, 1n);

    const created = await t.predict.read.getMarket([marketId]);
    assert.equal(created.state, STATE.Open);
    assert.equal(created.oracleUrl, ORACLE_URL);
    assert.equal(created.jsonPath, JSON_PATH);

    // All three attempts were booked in the creation transaction itself.
    const booking = (await t.scheduler.read.booking([
      created.scheduleId,
    ])) as SchedulerBooking;
    assert.equal(booking.numCalls, 3);
    assert.equal(booking.startBlock, Number(created.resolveBlock));
    assert.equal(
      booking.payer.toLowerCase(),
      t.predict.address.toLowerCase(),
      "the contract pays for its own resolution",
    );

    // ── bet ──
    await t.bet(t.alice, marketId, true, "3");
    await t.bet(t.bob, marketId, false, "1");

    const open = await t.predict.read.getMarket([marketId]);
    assert.equal(open.totalYes, parseEther("3"));
    assert.equal(open.totalNo, parseEther("1"));

    // ── the window closes on its own; no transaction flips it ──
    await t.networkHelpers.mine(
      Number(open.closeBlock - (await t.publicClient.getBlockNumber())),
    );
    assert.equal(
      (await t.predict.read.getMarket([marketId])).state,
      STATE.Closed,
    );
    await assert.rejects(t.bet(t.alice, marketId, true, "1"), /BettingClosed/);

    // ── nobody presses resolve: the Scheduler wakes the contract ──
    await t.mineToResolveBlock(marketId);
    await t.fire(0n, marketId);

    const resolved = await t.predict.read.getMarket([marketId]);
    assert.equal(resolved.state, STATE.Resolved);
    assert.equal(resolved.outcome, OUTCOME.Yes, "4200 >= 4000");
    assert.equal(resolved.observedValue, 4_200n);
    assert.equal(resolved.attempts, 1);

    // It read the market's own rule, through the registry's executor.
    assert.equal(await t.http.read.lastUrl(), ORACLE_URL);
    assert.equal(await t.http.read.lastMethod(), 1, "GET");
    assert.equal(
      ((await t.http.read.lastExecutor()) as Address).toLowerCase(),
      t.executor.toLowerCase(),
    );

    // The remaining two bookings were cancelled once the read succeeded.
    assert.equal(await t.scheduler.read.getCallState([created.scheduleId]), 2);

    // ── claim ──
    const [, , , claimable] = await t.predict.read.stakesOf([
      marketId,
      t.alice.account.address,
    ]);
    assert.equal(claimable, parseEther("4"), "3 * 4 / 3, the whole pool");

    const claimHash = await t.predict.write.claimWinnings([marketId], {
      account: t.alice.account,
    });
    await t.publicClient.waitForTransactionReceipt({ hash: claimHash });

    assert.equal(
      await t.publicClient.getBalance({ address: t.predict.address }),
      0n,
      "the pool is fully distributed",
    );
    await assert.rejects(
      t.predict.write.claimWinnings([marketId], { account: t.bob.account }),
      /NothingToClaim/,
      "the losing side has nothing to claim",
    );

    await t.connection.close();
  });

  it("refunds everyone when the oracle is unreachable for all three attempts", async () => {
    const t = await setUpChain();

    const marketId = await t.createDemoMarket(
      "Will ETH/USD be at least $4,000 when this market resolves?",
      4_000n,
    );
    await t.bet(t.alice, marketId, true, "2");
    await t.bet(t.bob, marketId, false, "1");

    // The oracle goes dark before the first attempt.
    await t.http.write.setMode([HTTP_MODE.Reverts]);
    await t.mineToResolveBlock(marketId);

    const { scheduleId } = await t.predict.read.getMarket([marketId]);
    const retryInterval = await t.predict.read.RETRY_INTERVAL_BLOCKS();

    for (let attempt = 0n; attempt < 3n; attempt++) {
      await t.fire(attempt, marketId);
      const m = await t.predict.read.getMarket([marketId]);

      if (attempt < 2n) {
        // A failed read is never a NO: the market keeps retrying.
        assert.equal(m.state, STATE.Resolving);
        assert.equal(m.outcome, OUTCOME.Unresolved);
        await t.networkHelpers.mine(Number(retryInterval));
      } else {
        assert.equal(m.state, STATE.Invalid);
        assert.equal(m.outcome, OUTCOME.Unresolved);
        assert.equal(m.invalidReason, "http precompile reverted");
      }
    }

    assert.equal(
      (await t.predict.read.getMarket([marketId])).attempts,
      3,
      "all three booked attempts were spent",
    );
    // Nothing was cancelled: every booking ran.
    assert.equal(await t.scheduler.read.getCallState([scheduleId]), 1);

    // ── both sides take their original stake back ──
    for (const [who, staked] of [
      [t.alice, "2"],
      [t.bob, "1"],
    ] as const) {
      const [, , , claimable] = await t.predict.read.stakesOf([
        marketId,
        who.account.address,
      ]);
      assert.equal(claimable, parseEther(staked));

      const hash = await t.predict.write.claimRefund([marketId], {
        account: who.account,
      });
      await t.publicClient.waitForTransactionReceipt({ hash });
    }

    assert.equal(
      await t.publicClient.getBalance({ address: t.predict.address }),
      0n,
    );

    await t.connection.close();
  });
});
