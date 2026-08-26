import { defineChain } from "viem";

/**
 * Ritual Chain testnet.
 *
 * Note for anyone reading block timestamps here: on Ritual Chain they are Unix
 * milliseconds, not seconds. RitualPredict avoids them entirely and works in block
 * numbers, and so does this UI.
 */
export const ritualChain = defineChain({
  id: 1979,
  name: "Ritual",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_RITUAL_RPC_URL ?? "https://rpc.ritualfoundation.org",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Ritual Explorer",
      url: "https://explorer.ritualfoundation.org",
    },
  },
});

export const predictAddress = (process.env.NEXT_PUBLIC_PREDICT_ADDRESS ?? "") as
  | `0x${string}`
  | "";

export const demoOracleUrl =
  process.env.NEXT_PUBLIC_DEMO_ORACLE_URL ?? "http://localhost:3000/api/oracle/eth";

export function explorerAddress(address: string) {
  return `${ritualChain.blockExplorers.default.url}/address/${address}`;
}

export function explorerTx(hash: string) {
  return `${ritualChain.blockExplorers.default.url}/tx/${hash}`;
}
