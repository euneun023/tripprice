/** Free, no-key exchange rate lookup. Generic — any base/target currency pair. */

export interface FxRate {
  base: string;
  target: string;
  rate: number;
  fetchedAt: string;
}

export async function getFxRate(base: string, target: string): Promise<FxRate> {
  const url = `https://open.er-api.com/v6/latest/${base}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Exchange rate API responded ${res.status}`);
  }
  const body = (await res.json()) as {
    result: string;
    rates: Record<string, number>;
  };
  if (body.result !== "success") {
    throw new Error(`Exchange rate API returned result=${body.result}`);
  }
  const rate = body.rates[target];
  if (!rate) {
    throw new Error(`No rate found for ${base} -> ${target}`);
  }
  return { base, target, rate, fetchedAt: new Date().toISOString() };
}
