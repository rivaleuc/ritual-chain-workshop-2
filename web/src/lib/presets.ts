/** Comparator enum, matching RitualPredict.Comparator. */
export const COMPARATOR = {
  gt: 0,
  gte: 1,
  lt: 2,
  lte: 3,
} as const;

export type ComparatorKey = keyof typeof COMPARATOR;

export const COMPARATOR_LABEL: Record<ComparatorKey, string> = {
  gt: "greater than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
};

/** MarketState enum, matching RitualPredict.MarketState. */
export const MARKET_STATE = ["Open", "Closed", "Resolving", "Resolved", "Invalid"] as const;
export type MarketState = (typeof MARKET_STATE)[number];

/** Outcome enum, matching RitualPredict.Outcome. */
export const OUTCOME = ["Unresolved", "YES", "NO"] as const;

/**
 * The preset workshop market: short enough to demo end-to-end in a few minutes.
 * Mirrors DEMO_MARKET in hardhat/scripts/market-presets.ts.
 */
export const DEMO_MARKET = {
  question: "Will ETH/USD be at least $4,000 when this market resolves?",
  jsonPath: ".price",
  target: 4000,
  comparator: "gte" as ComparatorKey,
  bettingSeconds: 180,
  resolveDelaySeconds: 60,
};

/** Matches the on-chain Market struct returned by getMarket / getMarkets. */
export type Market = {
  id: bigint;
  creator: `0x${string}`;
  question: string;
  oracleUrl: string;
  jsonPath: string;
  target: bigint;
  comparator: number;
  closeBlock: bigint;
  resolveBlock: bigint;
  scheduleId: bigint;
  totalYes: bigint;
  totalNo: bigint;
  state: number;
  outcome: number;
  attempts: number;
  observedValue: bigint;
  invalidReason: string;
};
