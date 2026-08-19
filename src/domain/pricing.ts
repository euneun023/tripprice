/**
 * Single source of truth for "price + currency -> KRW". Both the initial
 * approval (mappingService) and the refresh cycle (refreshService) need
 * this - it used to be duplicated inline in refreshService only, with
 * mappingService just storing null. Comparison (comparisonService) also
 * uses this so all three call sites agree on the exact same conversion.
 */
import { getFxRate } from "../adapters/exchangeRate";

export interface KrwConversion {
  krwPrice: number;
  fxRateUsed: number;
}

export async function convertToKrw(price: number, currency: string): Promise<KrwConversion> {
  if (currency === "KRW") {
    return { krwPrice: price, fxRateUsed: 1 };
  }
  const fx = await getFxRate(currency, "KRW");
  return { krwPrice: Math.round(price * fx.rate), fxRateUsed: fx.rate };
}
