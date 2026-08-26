# Proof of Building — Bootcamp 2

Fork of [cozfuttu/ritual-chain-workshop-2](https://github.com/cozfuttu/ritual-chain-workshop-2).

## What the starter left open

The starter is not a fill-in-the-blanks exercise, but it is not finished either. Five
functions in `RitualPredict.sol` were stubbed with `// we'll fill this up`:

- `createMarket`
- `onScheduledResolve`, the Scheduler callback
- `_readOracle`, the HTTP and jq precompile path
- `_pickExecutor`
- `_scheduleResolution`

`hardhat/README.md` also referenced three files that were not in the tree:
`RitualPredict.t.sol`, `mocks/RitualMocks.sol`, and `test/RitualPredict.e2e.ts`.

## What I built

**The five functions.** The HTTP request is the 13-field `HTTPCallRequest` layout from
the Ritual dApp skills, not a guess. Resolution parameters stay immutable, the executor
seed is re-rolled per attempt so a retry can land somewhere else, and `maxFeePerGas` is
floored so a cheap creation block cannot under-price a resolution 200 blocks later.

**The mocks and 54 Solidity tests.** `vm.etch` installs the mocks at the canonical
Ritual addresses, so the contract under test is byte-for-byte the one that would be
deployed. The failure cases are the point: `RitualPredict` must never read a broken
oracle as a NO, so there is a test for each way the read can break, a reverting
precompile, an undecodable envelope, an unsettled async output, an executor error
message, a non-200 status, a body jq cannot parse, and an empty executor registry.

**Two end-to-end TypeScript tests** driving the flow the way a script or the UI does,
over JSON-RPC with `hardhat_setCode`.

**A local-node demo and seed.** `scripts/local-demo.ts` narrates one market from
creation through a failed read, a successful retry and the payout.
`scripts/local-seed.ts` leaves a running node loaded with markets in every state.
Captured output is in [hardhat/docs/local-run.md](hardhat/docs/local-run.md).

**A frontend** with the demo oracle the markets read. It talks to Ritual Chain, or to a
local node with `NEXT_PUBLIC_CHAIN=local`, which is the only way to see it working while
the chain is down.

## Three starter bugs fixed

- `hardhat.config.ts` read `DEPLOYER_PRIVATE_KEY`; `.env.example` and `scripts/ritual.ts`
  both use `RITUAL_PRIVATE_KEY`. Every script failed on a missing configuration variable.
- `tsconfig.json` lacked `allowImportingTsExtensions`, so `tsc` rejected every local
  import in `scripts/` and `test/`.
- `test/Counter.ts` came from the Hardhat template and referenced a contract that does
  not exist here, so it failed on every run.

## What is not verified

**Nothing here has been deployed to Ritual Chain.** The chain was unreachable, so there
is no deployed address, no real TEE executor response, no real Scheduler execution, and
no confirmation that the fee accounting works against the live RitualWallet. Everything
below the contract's own logic is mocked.

What the local runs do establish: the lifecycle, the retry and invalidation paths, the
comparator table, and that the payout arithmetic drains the pool to zero. What they
cannot: anything that depends on the chain actually being there.

The oracle is also not trustless. Whoever creates a market picks the endpoint that
decides it. The TEE attests that the response was fetched as specified, not that the
endpoint is honest.
