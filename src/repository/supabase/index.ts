import { getSupabaseClient } from "../../db/supabaseClient";
import type { Repositories } from "../types";
import { SupabaseSourceRepository } from "./SourceRepository";
import { SupabaseCanonicalProductRepository } from "./CanonicalProductRepository";
import { SupabaseSourceListingRepository } from "./SourceListingRepository";
import { SupabasePriceHistoryRepository } from "./PriceHistoryRepository";
import { SupabaseReviewActionRepository } from "./ReviewActionRepository";
import { SupabaseRefreshLeaseRepository } from "./RefreshLeaseRepository";

/** Wires up the Supabase-backed implementation of every repository interface. */
export function createSupabaseRepositories(): Repositories {
  const db = getSupabaseClient();
  return {
    sources: new SupabaseSourceRepository(db),
    canonicalProducts: new SupabaseCanonicalProductRepository(db),
    sourceListings: new SupabaseSourceListingRepository(db),
    priceHistory: new SupabasePriceHistoryRepository(db),
    reviewActions: new SupabaseReviewActionRepository(db),
    refreshLease: new SupabaseRefreshLeaseRepository(db),
  };
}
