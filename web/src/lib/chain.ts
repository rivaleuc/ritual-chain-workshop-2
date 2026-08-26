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

/**
 * A local `npx hardhat node` seeded by hardhat/scripts/local-seed.ts. Set
 * NEXT_PUBLIC_CHAIN=local to point the UI at it. There is no explorer, so the
 * transaction links are hidden rather than pointing somewhere that cannot resolve them.
 */
export const localChain = defineChain({
  id: 31337,
  name: "Hardhat",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_LOCAL_RPC_URL ?? "http://127.0.0.1:8545"],
    },
  },
});

export const isLocalChain = process.env.NEXT_PUBLIC_CHAIN === "local";
export const activeChain = isLocalChain ? localChain : ritualChain;

export const predictAddress = (process.env.NEXT_PUBLIC_PREDICT_ADDRESS ?? "") as
  | `0x${string}`
  | "";

export const demoOracleUrl =
  process.env.NEXT_PUBLIC_DEMO_ORACLE_URL ?? "http://localhost:3000/api/oracle/eth";

const explorer = activeChain.blockExplorers?.default.url;

export function explorerAddress(address: string) {
  return explorer ? `${explorer}/address/${address}` : null;
}

export function explorerTx(hash: string) {
  return explorer ? `${explorer}/tx/${hash}` : null;
}
