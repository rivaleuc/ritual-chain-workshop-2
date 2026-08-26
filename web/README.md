# Ritual Predict — web

The market UI and the demo oracle the markets read.

## Why there is an oracle in here

`RitualPredict` resolves by calling an HTTP endpoint from inside a TEE. Something has
to be at the other end of that call, and pointing a workshop demo at a third-party API
means the market's fate depends on that API's rate limits. So the endpoint lives next
to the UI: `/api/oracle/eth` returns `{ price, source, asOf }` with `price` as a whole
number of dollars, because jq extracts it as a `uint256`.

It reports where the number came from. `coinbase` is a live spot price, `fallback` is a
fixed value used when the upstream is unreachable, and `pinned` is `?price=3500`, which
is how you demo a NO outcome without waiting for the market to move.

## The localhost trap

The TEE executor performing the HTTP call runs off-chain. It cannot reach
`http://localhost:3000`, so a market created against a localhost URL will fail all
three resolution attempts and settle `Invalid`. Expose the endpoint first:

```bash
cloudflared tunnel --url http://localhost:3000
```

Then set `NEXT_PUBLIC_DEMO_ORACLE_URL` to the public address. The UI shows a warning
while the configured URL is still local.

## Seeing it work without the chain

Ritual Chain is unreachable, so the UI can talk to a local Hardhat node instead:

```bash
cd ../hardhat && npx hardhat node                                  # terminal 1
npx hardhat run scripts/local-seed.ts --network localhost          # terminal 2
```

The seed script prints the contract address and the `.env.local` lines to paste. Set
`NEXT_PUBLIC_CHAIN=local` and the UI points at chain 31337 instead of Ritual, with four
markets already on it: two open, one resolved with winnings to claim, one invalid with
refunds waiting. Add the node to your wallet as chain 31337 at http://127.0.0.1:8545 and
import one of the account keys the node printed to use the claim buttons.

On a local node the precompiles are mocks, so markets resolve against whatever the seed
script set rather than against this app's oracle route. The oracle card says so.

## Configuration

Copy `.env.example` to `.env.local`. `NEXT_PUBLIC_PREDICT_ADDRESS` comes from
`hardhat/scripts/deploy.ts`. The WalletConnect project id is optional; injected wallets
connect without it.

The contract ABI in `src/lib/predict-abi.ts` is generated, not written by hand:

```bash
cd ../hardhat && npx hardhat build && npx hardhat run scripts/export-abi.ts
```

## One bundler note

`next.config.ts` resolves `@base-org/account` to a local stub. `@wagmi/connectors`
reaches it through a lazy import for the Base Account wallet, which this app never
offers, but the bundler still walks the import graph and drags in the Coinbase CDP
SDK, the x402 payment packages and the Solana stack. The stub throws if it is ever
actually called, so a wiring mistake would be loud rather than silent.
