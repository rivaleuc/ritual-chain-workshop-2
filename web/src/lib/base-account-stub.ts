/**
 * Stand-in for @base-org/account.
 *
 * @wagmi/connectors lazily imports it the first time someone picks the Base Account
 * wallet. Nobody can: this app configures Ritual Chain only. Resolving it here keeps
 * the Coinbase CDP SDK, the x402 payment packages and the whole Solana stack out of a
 * prediction market that stakes the chain's native asset and nothing else.
 *
 * It throws rather than returning a fake SDK, so a wiring mistake is loud.
 */
export function createBaseAccountSDK(): never {
  throw new Error(
    "Base Account is not available in Ritual Predict. Connect an injected wallet or WalletConnect.",
  );
}
