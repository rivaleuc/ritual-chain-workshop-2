import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    // A `npx hardhat node` running in another terminal. Used by the local demo and
    // seed scripts, which stand the Ritual system contracts up as mocks so the whole
    // lifecycle can be exercised without chain access. Accounts come from the node.
    localhost: {
      type: "http",
      chainType: "l1",
      chainId: 31337,
      url: "http://127.0.0.1:8545",
    },
    // Ritual Chain testnet. Requires EIP-1559 (type-2) transactions; viem sends
    // those by default.
    ritual: {
      type: "http",
      chainType: "l1",
      chainId: 1979,
      // RITUAL_RPC_URL is optional; the public RPC is the default.
      url: process.env.RITUAL_RPC_URL ?? "https://rpc.ritualfoundation.org",
      // Named to match .env.example and scripts/ritual.ts.
      accounts: [configVariable("RITUAL_PRIVATE_KEY")],
    },
  },
});
