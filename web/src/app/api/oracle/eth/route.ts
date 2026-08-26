/**
 * The demo oracle the workshop markets read.
 *
 * RitualPredict extracts one integer from this response with the jq precompile
 * (jsonPath `.price`, outputType uint256), so `price` is always a whole number of
 * dollars. `source` records where it came from, because a market that settles on a
 * made-up number is not worth demoing.
 *
 * The TEE executor performing the HTTP call runs off-chain and cannot reach
 * localhost. Expose this publicly before creating a market:
 *   cloudflared tunnel --url http://localhost:3000
 *
 * Pass ?price=3500 to pin the value. That is how you demo a NO outcome without
 * waiting for the market to move.
 */
export const dynamic = "force-dynamic";

const UPSTREAM = "https://api.coinbase.com/v2/prices/ETH-USD/spot";
const FALLBACK_PRICE = 4200;

type OraclePayload = {
  price: number;
  source: "coinbase" | "pinned" | "fallback";
  asOf: string;
};

function json(payload: OraclePayload) {
  return Response.json(payload, {
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(request: Request) {
  const asOf = new Date().toISOString();

  const pinned = new URL(request.url).searchParams.get("price");
  if (pinned !== null) {
    const price = Math.round(Number(pinned));
    if (Number.isFinite(price) && price >= 0) {
      return json({ price, source: "pinned", asOf });
    }
  }

  try {
    const response = await fetch(UPSTREAM, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (response.ok) {
      const body = (await response.json()) as { data?: { amount?: string } };
      const price = Math.round(Number(body.data?.amount));
      if (Number.isFinite(price) && price > 0) {
        return json({ price, source: "coinbase", asOf });
      }
    }
  } catch {
    // Fall through: an unreachable upstream must still produce a valid response,
    // otherwise the market resolves Invalid for the wrong reason.
  }

  return json({ price: FALLBACK_PRICE, source: "fallback", asOf });
}
