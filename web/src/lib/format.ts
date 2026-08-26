import { formatEther } from "viem";

export function ritual(amount: bigint, digits = 4) {
  const value = Number(formatEther(amount));
  return `${value.toFixed(digits).replace(/\.?0+$/, "")} RITUAL`;
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Blocks remaining rendered as a rough wall-clock estimate. Ritual Chain runs at
 * roughly 195ms per block, so a few hundred blocks is about a minute.
 */
export function blocksAway(target: bigint, current: bigint, blockTimeMs = 195) {
  if (current >= target) return null;
  const blocks = Number(target - current);
  const seconds = Math.round((blocks * blockTimeMs) / 1000);
  if (seconds < 60) return `${blocks} blocks, about ${seconds}s`;
  return `${blocks} blocks, about ${Math.round(seconds / 60)}m`;
}

/** Percentage of the pool on the YES side, or null when nothing is staked. */
export function yesShare(totalYes: bigint, totalNo: bigint) {
  const pool = totalYes + totalNo;
  if (pool === 0n) return null;
  return Number((totalYes * 10000n) / pool) / 100;
}
