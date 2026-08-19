import type { SupabaseClient } from "@supabase/supabase-js";
import type { SourceRepository } from "../types";
import { rowToSource } from "./mappers";

export class SupabaseSourceRepository implements SourceRepository {
  constructor(private db: SupabaseClient) {}

  async listAll() {
    const { data, error } = await this.db.from("sources").select();
    if (error) throw error;
    return (data ?? []).map(rowToSource);
  }

  async getById(id: string) {
    const { data, error } = await this.db.from("sources").select().eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? rowToSource(data) : null;
  }
}
