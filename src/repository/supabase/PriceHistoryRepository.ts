import type { SupabaseClient } from "@supabase/supabase-js";
import type { PriceHistoryEntry } from "../../domain/types";
import type { PriceHistoryRepository } from "../types";

export class SupabasePriceHistoryRepository implements PriceHistoryRepository {
  constructor(private db: SupabaseClient) {}

  async append(entry: PriceHistoryEntry): Promise<void> {
    const { error } = await this.db.from("price_history").insert({
      source_listing_id: entry.sourceListingId,
      price: entry.price,
      currency: entry.currency,
      krw_price: entry.krwPrice,
      fx_rate_used: entry.fxRateUsed,
      availability: entry.availability,
      outcome: entry.outcome,
      change_reason: entry.changeReason,
    });
    if (error) throw error;
  }

  async listForListing(sourceListingId: string, limit = 50): Promise<PriceHistoryEntry[]> {
    const { data, error } = await this.db
      .from("price_history")
      .select()
      .eq("source_listing_id", sourceListingId)
      .order("checked_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      sourceListingId: row.source_listing_id,
      price: row.price === null ? null : Number(row.price),
      currency: row.currency,
      krwPrice: row.krw_price === null ? null : Number(row.krw_price),
      fxRateUsed: row.fx_rate_used === null ? null : Number(row.fx_rate_used),
      availability: row.availability,
      outcome: row.outcome,
      changeReason: row.change_reason,
    }));
  }
}
