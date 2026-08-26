# Ritual Predict — contracts

The `RitualPredict` market contract, its tests, and the deployment scripts.
Full architecture and the workshop runbook live in [../README.md](../README.md).

## Layout

```
contracts/
  RitualPredict.sol          the market: creation, betting, autonomous resolution, payouts
  RitualPredict.t.sol        Solidity unit tests
  ritual/RitualChain.sol     canonical Ritual addresses + system contract interfaces
  mocks/RitualMocks.sol      test-only stand-ins for the precompiles and system contracts
test/
  RitualPredict.e2e.ts       end-to-end walkthroughs of the workshop flow
scripts/
  block-time.ts              measure the chain's current block time
  local-chain.ts             shared plumbing for the local-node scripts
  local-demo.ts              narrated full lifecycle on a local node
  local-seed.ts              seed a local node with markets in every state
  deploy.ts                  deploy + prepay execution fees
  fund.ts                    top up the prepaid execution balance
  status.ts                  live state of every market
  create-demo-market.ts      create the preset market from the CLI
  export-abi.ts              copy the compiled ABI into the frontend
docs/
  local-run.md               captured output of the runs below
```

## Commands

```bash
cp .env.example .env                            # RITUAL_PRIVATE_KEY, funded from the faucet

npx hardhat test                                # 54 Solidity + 2 TypeScript tests
npx hardhat test solidity                       # Solidity only
npx hardhat test nodejs                         # TypeScript only
npx hardhat build                               # compile
npx tsc --noEmit                                # typecheck the scripts and tests

npx hardhat run scripts/block-time.ts           # measure block time

# Local node, no chain access needed. Run `npx hardhat node` in another terminal.
npx hardhat run scripts/local-demo.ts --network localhost   # narrated lifecycle
npx hardhat run scripts/local-seed.ts --network localhost   # seed state for the UI

npx hardhat run scripts/deploy.ts               # deploy to Ritual Chain
PREDICT_ADDRESS=0x... npx hardhat run scripts/status.ts
PREDICT_ADDRESS=0x... npx hardhat run scripts/fund.ts
```

Tests run entirely against mocks. `vm.etch` puts the mock runtime code at the canonical Ritual
addresses, and the TypeScript tests do the same over JSON-RPC with `hardhat_setCode`, so the
contract under test is byte-for-byte the one that gets deployed: it still reaches for 0x0801,
0x0803, the Scheduler and the RitualWallet by their real addresses. No network access and no
funded account are needed.

The failure cases are the interesting half of the suite. `RitualPredict` must never read a broken
oracle as a NO, so there is a test for each way the read can break: a reverting precompile, an
undecodable envelope, an async output that has not settled yet, an executor that returns an error
message, a non-200 status, a body jq cannot parse, and an empty executor registry.

## Running it without the chain

Ritual Chain was unreachable while this was built, so the whole lifecycle is exercised
locally instead. `scripts/local-chain.ts` installs the mocks at the canonical addresses
with `hardhat_setCode`, which leaves `RitualPredict` unmodified: the only thing being
faked is what answers.

`local-demo.ts` narrates one market from creation through a failed read, a successful
retry, and the payout. `local-seed.ts` leaves a node loaded with four markets in
different states so the frontend has real state to render.

Captured output from both, plus the build, typecheck and test runs, is in
[docs/local-run.md](docs/local-run.md). What that does and does not establish is stated
at the top of that file: it proves the contract's logic and wiring, not that a real TEE
executor answers or that the real Scheduler fires on time.
