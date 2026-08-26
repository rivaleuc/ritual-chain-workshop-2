/**
 * A narrated run of one market's whole life on a local Hardhat node.
 *
 *   Terminal 1:  npx hardhat node
 *   Terminal 2:  npx hardhat run scripts/local-demo.ts --network localhost
 *
 * Ritual Chain is not reachable, so the Scheduler, the RitualWallet, the TEE registry
 * and both precompiles are mocks installed at their canonical addresses. RitualPredict
 * itself is unmodified. What this proves is the contract's own logic and wiring: that
 * creation books its own resolution, that the callback reads the oracle and settles,
 * that a broken oracle never becomes a NO, and that the payout arithmetic balances.
 *
 * What it cannot prove is that a real TEE executor answers, or that the real Scheduler
 * fires on time. Those need the chain.
 */
import { formatEther, parseEther } from "viem";

import {
  OUTCOME_LABEL,
  STATE_LABEL,
  type SchedulerBooking,
  connectLocalChain,
  marketArgs,
} from "./local-chain.ts";

const ORACLE_URL = "https://oracle.example/api/eth";

function step(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 56 - title.length))}`);
}

function line(label: string, value: string) {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

function ritual(amount: bigint) {
  return `${formatEther(amount)} RITUAL`;
}

const t = await connectLocalChain();

console.log("Ritual Predict — local lifecycle demo");
line("Node", "http://127.0.0.1:8545 (chain 31337)");
line("RitualPredict", t.predict.address);
line("Deployer", t.deployer.account.address);

// ─────────────────────────────────────────────────────────────────────────────
step("1. Prepay execution fees");

const fundHash = await t.predict.write.fundExecution([500_000n], {
  value: parseEther("0.5"),
});
await t.publicClient.waitForTransactionReceipt({ hash: fundHash });
line("Execution balance", ritual(await t.predict.read.executionBalance()));
console.log(
  "  Every scheduled resolution is paid from this balance, not from the caller.",
);

// ─────────────────────────────────────────────────────────────────────────────
step("2. Create a market");

await t.setOracle(4_200n);
const marketId = await t.createMarket(
  marketArgs(
    "Will ETH/USD be at least $4,000 when this market resolves?",
    4_000n,
    ORACLE_URL,
  ),
);

const created = await t.predict.read.getMarket([marketId]);
line("Market", `#${marketId} ${created.question}`);
line("Rule", `observed >= ${created.target} against ${created.jsonPath}`);
line("Betting closes", `block ${created.closeBlock}`);
line("First attempt", `block ${created.resolveBlock}`);

const booking = (await t.scheduler.read.booking([
  created.scheduleId,
])) as SchedulerBooking;
line("Scheduler booking", `#${created.scheduleId}`);
line(
  "  attempts",
  `${booking.numCalls}, ${booking.frequency} blocks apart, starting ${booking.startBlock}`,
);
line("  payer", booking.payer);
console.log(
  "  The market booked its own resolution in the same transaction that created it.",
);

// ─────────────────────────────────────────────────────────────────────────────
step("3. Take bets");

await t.bet(t.alice, marketId, true, "3");
await t.bet(t.bob, marketId, false, "1");

const open = await t.predict.read.getMarket([marketId]);
line("YES pool", ritual(open.totalYes));
line("NO pool", ritual(open.totalNo));
line("Contract balance", ritual(await t.publicClient.getBalance({ address: t.predict.address })));

// ─────────────────────────────────────────────────────────────────────────────
step("4. The betting window closes on its own");

await t.mineToCloseBlock(marketId);
const closed = await t.predict.read.getMarket([marketId]);
line("State", STATE_LABEL[closed.state]);
console.log("  No transaction flipped it. The deadline is a block number, and the view reads it.");

try {
  await t.bet(t.alice, marketId, true, "1");
  console.log("  ! A bet went through after the close block, which should be impossible.");
} catch {
  line("Late bet", "rejected (BettingClosed)");
}

// ─────────────────────────────────────────────────────────────────────────────
step("5. A failed oracle read is not a NO");

await t.breakOracle();
await t.mineToResolveBlock(marketId);
await t.fire(0n, marketId);

const afterFailure = await t.predict.read.getMarket([marketId]);
line("State", STATE_LABEL[afterFailure.state]);
line("Outcome", OUTCOME_LABEL[afterFailure.outcome]);
line("Attempts used", `${afterFailure.attempts} of 3`);
console.log(
  "  The executor was unreachable. The market is retrying, not settling against the\n" +
    "  side that happens to benefit from silence.",
);

// ─────────────────────────────────────────────────────────────────────────────
step("6. The retry succeeds and the market settles");

await t.setOracle(4_200n);
await t.networkHelpers.mine(Number(await t.predict.read.RETRY_INTERVAL_BLOCKS()));
await t.fire(1n, marketId);

const resolved = await t.predict.read.getMarket([marketId]);
line("State", STATE_LABEL[resolved.state]);
line("Observed", resolved.observedValue.toString());
line("Outcome", `${OUTCOME_LABEL[resolved.outcome]} (${resolved.observedValue} >= ${resolved.target})`);
line("Read through", (await t.http.read.lastUrl()) as string);
line("Executor used", (await t.http.read.lastExecutor()) as string);
line(
  "Remaining booking",
  (await t.scheduler.read.getCallState([resolved.scheduleId])) === 2
    ? "cancelled"
    : "still active",
);

// ─────────────────────────────────────────────────────────────────────────────
step("7. Winners pull their share");

const [, , , aliceClaimable] = await t.predict.read.stakesOf([
  marketId,
  t.alice.account.address,
]);
line("Alice claimable", `${ritual(aliceClaimable)} (3 * 4 / 3)`);

const claimHash = await t.predict.write.claimWinnings([marketId], {
  account: t.alice.account,
});
await t.publicClient.waitForTransactionReceipt({ hash: claimHash });

line(
  "Contract balance",
  ritual(await t.publicClient.getBalance({ address: t.predict.address })),
);

try {
  await t.predict.write.claimWinnings([marketId], { account: t.bob.account });
  console.log("  ! The losing side claimed, which should be impossible.");
} catch {
  line("Bob (backed NO)", "nothing to claim");
}

// ─────────────────────────────────────────────────────────────────────────────
step("8. A market the oracle never answers");

await t.setOracle(4_200n);
const deadId = await t.createMarket(
  marketArgs("Will the oracle answer at all?", 1n, ORACLE_URL, 30n, 15n),
);
await t.bet(t.alice, deadId, true, "2");
await t.bet(t.bob, deadId, false, "1");

await t.mineToCloseBlock(deadId);
await t.breakOracle();
await t.exhaustAttempts(deadId);

const dead = await t.predict.read.getMarket([deadId]);
line("State", STATE_LABEL[dead.state]);
line("Outcome", OUTCOME_LABEL[dead.outcome]);
line("Reason", dead.invalidReason);

for (const [name, who] of [
  ["Alice", t.alice],
  ["Bob", t.bob],
] as const) {
  const hash = await t.predict.write.claimRefund([deadId], { account: who.account });
  await t.publicClient.waitForTransactionReceipt({ hash });
  line(`${name} refunded`, "original stake returned");
}

line(
  "Contract balance",
  ritual(await t.publicClient.getBalance({ address: t.predict.address })),
);

console.log(
  "\nBoth markets are settled and the contract holds nothing. Sub-wei dust from integer\n" +
    "division is the only thing that can ever be left behind.",
);

await t.connection.close();
