# Local run log

Ritual Chain was unreachable while this was built, so everything below ran against a
local Hardhat node with the Ritual system contracts and precompiles installed as mocks
at their canonical addresses. `RitualPredict` itself is unmodified: it still calls
0x0801, 0x0803, the Scheduler and the RitualWallet by their real addresses.

**What this proves:** the contract's own logic and wiring. Creation books its own
resolution, the callback reads the oracle and settles, a broken oracle never becomes a
NO, the retry path works, and the payout arithmetic balances to zero.

**What it does not prove:** that a real TEE executor answers, that the real Scheduler
fires on time, or that the fee accounting on the live chain is correct. Those need the
chain, and none of them were tested here.

Every block below is captured output, not a transcript written by hand. Reproduce each
one with the command in its heading.

---

## `npx hardhat build`

```

Compiled 4 Solidity files with solc 0.8.28 (evm target: cancun)
```

## `npx tsc --noEmit`

```
(no output)
```

## `npx hardhat test`

```
No contracts to compile

Running Solidity tests

  contracts/RitualPredict.t.sol:RitualPredictTest
    ✔ test_StakesOf_ReportsClaimableThroughEveryPhase()
    ✔ test_Resolve_YesWhenObservedSatisfiesTheComparator()
    ✔ test_Resolve_UnsettledAsyncOutputIsAFailureNotANo()
    ✔ test_Resolve_UnparseableBodyIsAFailureNotANo()
    ✔ test_Resolve_UnknownMarketDoesNotRevert()
    ✔ test_Resolve_UndecodableEnvelopeIsAFailureNotANo()
    ✔ test_Resolve_ThreeFailuresInvalidateTheMarket()
    ✔ test_Resolve_SurvivesAFailingCancel()
    ✔ test_Resolve_SendsTheMarketRuleToTheHttpPrecompile()
    ✔ test_Resolve_RetriesCanLandOnADifferentExecutor()
    ✔ test_Resolve_PrecompileRevertIsAFailureNotANo()
    ✔ test_Resolve_OnlyTheSchedulerMayCallBack()
    ✔ test_Resolve_Non200IsAFailureNotANo()
    ✔ test_Resolve_NoWhenObservedFailsTheComparator()
    ✔ test_Resolve_NoRegisteredExecutorIsAFailureNotANo()
    ✔ test_Resolve_IsIdempotentForLeftoverExecutions()
    ✔ test_Resolve_ExecutorErrorMessageIsAFailureNotANo()
    ✔ test_Resolve_EmptyWinningSideInvalidatesButKeepsTheOutcome()
    ✔ test_Resolve_CancelsTheRemainingBookedAttempts()
    ✔ test_Refund_RevertsOnAResolvedMarket()
    ✔ test_Refund_RevertsForAnAccountWithNoStake()
    ✔ test_Refund_ReturnsTheOriginalStakeAfterInvalidation()
    ✔ test_GetMarkets_ReturnsNewestFirst()
    ✔ test_GetMarket_ReportsClosedOnceTheWindowPasses()
    ✔ test_FundExecution_RevertsOnZeroValue()
    ✔ test_FundExecution_DepositsIntoTheContractsRitualWalletBalance()
    ✔ test_FundExecution_AcceptsTopUpsFromAnyone()
    ✔ test_CreateMarket_StoresTheRuleAndOpensBetting()
    ✔ test_CreateMarket_RevertsWhenTotalExceedsMaxMarketSeconds()
    ✔ test_CreateMarket_RevertsWhenSchedulingFails()
    ✔ test_CreateMarket_RevertsOnTooShortResolveDelay()
    ✔ test_CreateMarket_RevertsOnTooShortBettingWindow()
    ✔ test_CreateMarket_RevertsOnEmptyQuestion()
    ✔ test_CreateMarket_RevertsOnEmptyOracleUrl()
    ✔ test_CreateMarket_RevertsOnEmptyJsonPath()
    ✔ test_CreateMarket_EncodesCallbackWithZeroExecutionIndexPlaceholder()
    ✔ test_CreateMarket_EmitsCreationAndRuleSeparately()
    ✔ test_CreateMarket_BooksThreeAttemptsInOneScheduleCall()
    ✔ test_CreateMarket_AssignsSequentialIds()
    ✔ test_CreateMarket_ApprovesTheSchedulerAtConstruction()
    ✔ test_Constructor_RejectsZeroBlockTime()
    ✔ test_Comparator_LTE()
    ✔ test_Comparator_LT()
    ✔ test_Comparator_GTE()
    ✔ test_Comparator_GT()
    ✔ test_Claim_RevertsOnAnInvalidMarket()
    ✔ test_Claim_RevertsOnASecondAttempt()
    ✔ test_Claim_RevertsForTheLosingSide()
    ✔ test_Claim_RevertsBeforeResolution()
    ✔ test_Claim_PaysAProportionalShareOfTheWholePool()
    ✔ test_Bet_RevertsOnZeroStake()
    ✔ test_Bet_RevertsOnUnknownMarket()
    ✔ test_Bet_RevertsAtCloseBlock()
    ✔ test_Bet_AccumulatesPerSideAndPerAccount()

Running node:test tests

  RitualPredict end to end
    ✔ settles itself from the Scheduler callback and pays the winners (760ms)
    ✔ refunds everyone when the oracle is unreachable for all three attempts


56 passing (54 solidity, 2 nodejs)
```

---

## `npx hardhat run scripts/local-demo.ts --network localhost`

A narrated walk through one market's whole life, plus a second market the oracle never
answers. Needs `npx hardhat node` running in another terminal.

```

Ritual Predict — local lifecycle demo
  Node                   http://127.0.0.1:8545 (chain 31337)
  RitualPredict          0x0165878a594ca255338adfa4d48449f69242eb8f
  Deployer               0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266

── 1. Prepay execution fees ────────────────────────────────
  Execution balance      0.5 RITUAL
  Every scheduled resolution is paid from this balance, not from the caller.

── 2. Create a market ──────────────────────────────────────
  Market                 #1 Will ETH/USD be at least $4,000 when this market resolves?
  Rule                   observed >= 4000 against .price
  Betting closes         block 627
  First attempt          block 780
  Scheduler booking      #1
    attempts             3, 200 blocks apart, starting 780
    payer                0x0165878A594ca255338adfa4d48449f69242Eb8F
  The market booked its own resolution in the same transaction that created it.

── 3. Take bets ────────────────────────────────────────────
  YES pool               3 RITUAL
  NO pool                1 RITUAL
  Contract balance       4 RITUAL

── 4. The betting window closes on its own ─────────────────
  State                  Closed
  No transaction flipped it. The deadline is a block number, and the view reads it.
  Late bet               rejected (BettingClosed)

── 5. A failed oracle read is not a NO ─────────────────────
  State                  Resolving
  Outcome                Unresolved
  Attempts used          1 of 3
  The executor was unreachable. The market is retrying, not settling against the
  side that happens to benefit from silence.

── 6. The retry succeeds and the market settles ────────────
  State                  Resolved
  Observed               4200
  Outcome                YES (4200 >= 4000)
  Read through           https://oracle.example/api/eth
  Executor used          0x000000000000000000000000000000000000ee50
  Remaining booking      cancelled

── 7. Winners pull their share ─────────────────────────────
  Alice claimable        4 RITUAL (3 * 4 / 3)
  Contract balance       0 RITUAL
  Bob (backed NO)        nothing to claim

── 8. A market the oracle never answers ────────────────────
  State                  Invalid
  Outcome                Unresolved
  Reason                 http precompile reverted
  Alice refunded         original stake returned
  Bob refunded           original stake returned
  Contract balance       0 RITUAL

Both markets are settled and the contract holds nothing. Sub-wei dust from integer
division is the only thing that can ever be left behind.
```

---

## `npx hardhat run scripts/local-seed.ts --network localhost`

Leaves a running node loaded with markets in every state, so the frontend has real
on-chain state to render. The addresses change on every run.

```

Seeding a local node with Ritual Predict markets
  RitualPredict   0x0165878a594ca255338adfa4d48449f69242eb8f
  Oracle URL      http://localhost:3000/api/oracle/eth

Markets
  #4  Open      0 RITUAL staked
      Will ETH/USD be at least $10,000 when this market resolves?
  #3  Open      1.9 RITUAL staked
      Will ETH/USD be at least $2,500 when this market resolves?
  #2  Invalid   http precompile reverted
      Will the demo oracle stay reachable for all three attempts?
  #1  Resolved  YES, observed 4200
      Will ETH/USD be at least $4,000 when this market resolves?

Claimable positions
  Account #1 0x70997970c51812dc3a010c7d01b50e0d17dc79c8  market #1: 4 RITUAL
  Account #1 0x70997970c51812dc3a010c7d01b50e0d17dc79c8  market #2: 2 RITUAL
  Account #2 0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc  market #2: 1 RITUAL

Put this in web/.env.local, then run `pnpm dev` in web/:
  NEXT_PUBLIC_CHAIN=local
  NEXT_PUBLIC_PREDICT_ADDRESS=0x0165878a594ca255338adfa4d48449f69242eb8f
  NEXT_PUBLIC_DEMO_ORACLE_URL=http://localhost:3000/api/oracle/eth

Add the local node to your wallet as chain 31337 at http://127.0.0.1:8545 and
import one of the account private keys the node printed at startup.
```

After this, `NEXT_PUBLIC_CHAIN=local` in `web/.env.local` points the UI at the node and
the market board renders all four markets, their pool splits, the resolved outcome and
the refundable one.
