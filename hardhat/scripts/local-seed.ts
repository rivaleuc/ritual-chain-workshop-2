/**
 * Seed a running local Hardhat node with markets in every state, so the frontend has
 * something real to render while Ritual Chain is unreachable.
 *
 *   Terminal 1:  npx hardhat node
 *   Terminal 2:  npx hardhat run scripts/local-seed.ts --network localhost
 *   Terminal 3:  cd ../web && pnpm dev
 *
 * Deploys the mocks at the canonical Ritual addresses, deploys RitualPredict
 * unmodified, then leaves behind four markets: two still open, one resolved with
 * winnings to claim, and one invalid with refunds waiting.
 *
 * The claimable positions belong to the node's accounts #1 and #2, so import one of
 * those private keys into the wallet to see the claim and refund buttons light up.
 */
import { formatEther, parseEther } from "viem";

import {
  OUTCOME_LABEL,
  STATE_LABEL,
  connectLocalChain,
  marketArgs,
} from "./local-chain.ts";

/** Long enough that the open markets stay open while you click around. */
const OPEN_BETTING_SECONDS = 3_600n;
const SHORT_BETTING_SECONDS = 30n;
const RESOLVE_DELAY_SECONDS = 15n;

const ORACLE_URL =
  process.env.ORACLE_URL ?? "http://localhost:3000/api/oracle/eth";

const t = await connectLocalChain();

console.log("Seeding a local node with Ritual Predict markets");
console.log(`  RitualPredict   ${t.predict.address}`);
console.log(`  Oracle URL      ${ORACLE_URL}`);

const fundHash = await t.predict.write.fundExecution([500_000n], {
  value: parseEther("0.5"),
});
await t.publicClient.waitForTransactionReceipt({ hash: fundHash });

// ── 1. A market that resolved YES, with winnings waiting for account #1 ──
await t.setOracle(4_200n);
const resolvedId = await t.createMarket(
  marketArgs(
    "Will ETH/USD be at least $4,000 when this market resolves?",
    4_000n,
    ORACLE_URL,
    SHORT_BETTING_SECONDS,
    RESOLVE_DELAY_SECONDS,
  ),
);
await t.bet(t.alice, resolvedId, true, "3");
await t.bet(t.bob, resolvedId, false, "1");
await t.mineToResolveBlock(resolvedId);
await t.fire(0n, resolvedId);

// ── 2. A market the oracle never answered, refundable by both sides ──
const invalidId = await t.createMarket(
  marketArgs(
    "Will the demo oracle stay reachable for all three attempts?",
    1n,
    "https://unreachable.example/api/eth",
    SHORT_BETTING_SECONDS,
    RESOLVE_DELAY_SECONDS,
  ),
);
await t.bet(t.alice, invalidId, true, "2");
await t.bet(t.bob, invalidId, false, "1");
await t.breakOracle();
await t.exhaustAttempts(invalidId);
await t.setOracle(4_200n);

// ── 3. An open market with a lopsided pool ──
const busyId = await t.createMarket(
  marketArgs(
    "Will ETH/USD be at least $2,500 when this market resolves?",
    2_500n,
    ORACLE_URL,
    OPEN_BETTING_SECONDS,
    RESOLVE_DELAY_SECONDS,
  ),
);
await t.bet(t.alice, busyId, true, "1.5");
await t.bet(t.bob, busyId, false, "0.4");

// ── 4. An open market nobody has touched ──
const emptyId = await t.createMarket(
  marketArgs(
    "Will ETH/USD be at least $10,000 when this market resolves?",
    10_000n,
    ORACLE_URL,
    OPEN_BETTING_SECONDS,
    RESOLVE_DELAY_SECONDS,
  ),
);

// ── report ──
console.log("\nMarkets");
for (const id of [emptyId, busyId, invalidId, resolvedId]) {
  const m = await t.predict.read.getMarket([id]);
  const pool = m.totalYes + m.totalNo;
  const detail =
    m.state === 3
      ? `${OUTCOME_LABEL[m.outcome]}, observed ${m.observedValue}`
      : m.state === 4
        ? m.invalidReason
        : `${formatEther(pool)} RITUAL staked`;
  console.log(`  #${id}  ${STATE_LABEL[m.state].padEnd(9)} ${detail}`);
  console.log(`      ${m.question}`);
}

console.log("\nClaimable positions");
for (const [name, who] of [
  ["Account #1", t.alice],
  ["Account #2", t.bob],
] as const) {
  for (const id of [resolvedId, invalidId]) {
    const [, , settled, claimable] = await t.predict.read.stakesOf([
      id,
      who.account.address,
    ]);
    if (!settled && claimable > 0n) {
      console.log(
        `  ${name} ${who.account.address}  market #${id}: ${formatEther(claimable)} RITUAL`,
      );
    }
  }
}

console.log("\nPut this in web/.env.local, then run `pnpm dev` in web/:");
console.log("  NEXT_PUBLIC_CHAIN=local");
console.log(`  NEXT_PUBLIC_PREDICT_ADDRESS=${t.predict.address}`);
console.log(`  NEXT_PUBLIC_DEMO_ORACLE_URL=${ORACLE_URL}`);
console.log(
  "\nAdd the local node to your wallet as chain 31337 at http://127.0.0.1:8545 and\nimport one of the account private keys the node printed at startup.",
);

await t.connection.close();
