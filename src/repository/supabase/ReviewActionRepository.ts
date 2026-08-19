import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewActionInput } from "../../domain/types";
import type { ReviewActionRepository } from "../types";

export class SupabaseReviewActionRepository implements ReviewActionRepository {
  constructor(private db: SupabaseClient) {}

  async record(input: ReviewActionInput): Promise<void> {
    const { error } = await this.db.from("review_actions").insert({
      source_listing_id: input.sourceListingId,
      reason: input.reason,
      detected_at: input.detectedAt,
      resolved_by: input.resolvedBy ?? null,
      resolution: input.resolution ?? null,
      note: input.note ?? null,
    });
    if (error) throw error;
  }
}
