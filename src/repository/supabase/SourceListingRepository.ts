import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewSourceListingInput, SourceListing } from "../../domain/types";
import type { SourceListingRepository } from "../types";
import { rowToSourceListing } from "./mappers";

export class SupabaseSourceListingRepository implements SourceListingRepository {
  constructor(private db: SupabaseClient) {}

  async create(input: NewSourceListingInput): Promise<SourceListing> {
    const now = new Date().toISOString();
    const { data, error } = await this.db
      .from("source_listings")
      .insert({
        product_variant_id: input.productVariantId,
        source_id: input.sourceId,
        external_id: input.externalId,
        external_id_type: input.externalIdType,
        source_url: input.sourceUrl,
        search_keyword_used: input.searchKeywordUsed,
        approved_by: input.approvedBy,
        confidence: input.confidence,
        stale_after_hours: input.staleAfterHours ?? 24,
        last_checked_at: now,
        last_success_at: now,
        review_required: false,
        review_reason: null,
        last_known_price: input.initialPrice,
        last_known_currency: input.initialCurrency,
        last_known_availability: input.initialAvailability,
      })
      .select()
      .single();
    if (error) throw error;
    return rowToSourceListing(data);
  }

  async getById(id: string): Promise<SourceListing | null> {
    const { data, error } = await this.db.from("source_listings").select().eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? rowToSourceListing(data) : null;
  }

  async findByExternalId(sourceId: string, externalId: string): Promise<SourceListing | null> {
    const { data, error } = await this.db
      .from("source_listings")
      .select()
      .eq("source_id", sourceId)
      .eq("external_id", externalId)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToSourceListing(data) : null;
  }

  async listByVariant(productVariantId: string): Promise<SourceListing[]> {
    const { data, error } = await this.db
      .from("source_listings")
      .select()
      .eq("product_variant_id", productVariantId)
      .eq("is_active", true);
    if (error) throw error;
    return (data ?? []).map(rowToSourceListing);
  }

  async listDueForRefresh(sourceId: string, limit: number, checkedBefore?: string): Promise<SourceListing[]> {
    let query = this.db.from("source_listings").select().eq("source_id", sourceId).eq("is_active", true);
    // checkedBefore is caller-generated (never raw user/request input - see
    // the interface doc comment) and is always a plain ISO timestamp string,
    // so interpolating it into the .or() filter expression carries none of
    // the injection risk a user-controlled value would.
    if (checkedBefore) {
      query = query.or(`last_checked_at.is.null,last_checked_at.lt.${checkedBefore}`);
    }
    const { data, error } = await query
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(rowToSourceListing);
  }

  async listReviewQueue(): Promise<SourceListing[]> {
    const { data, error } = await this.db
      .from("source_listings")
      .select()
      .eq("review_required", true)
      .eq("is_active", true)
      .order("updated_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(rowToSourceListing);
  }

  async listActiveUnflagged(): Promise<SourceListing[]> {
    const { data, error } = await this.db
      .from("source_listings")
      .select()
      .eq("is_active", true)
      .eq("review_required", false);
    if (error) throw error;
    return (data ?? []).map(rowToSourceListing);
  }

  async update(id: string, patch: Record<string, unknown>): Promise<SourceListing> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ("lastCheckedAt" in patch) dbPatch.last_checked_at = patch.lastCheckedAt;
    if ("lastSuccessAt" in patch) dbPatch.last_success_at = patch.lastSuccessAt;
    if ("reviewRequired" in patch) dbPatch.review_required = patch.reviewRequired;
    if ("reviewReason" in patch) dbPatch.review_reason = patch.reviewReason;
    if ("lastKnownPrice" in patch) dbPatch.last_known_price = patch.lastKnownPrice;
    if ("lastKnownCurrency" in patch) dbPatch.last_known_currency = patch.lastKnownCurrency;
    if ("lastKnownAvailability" in patch) dbPatch.last_known_availability = patch.lastKnownAvailability;
    if ("isActive" in patch) dbPatch.is_active = patch.isActive;
    if ("externalId" in patch) dbPatch.external_id = patch.externalId;

    const { data, error } = await this.db
      .from("source_listings")
      .update(dbPatch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return rowToSourceListing(data);
  }
}
