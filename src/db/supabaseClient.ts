/**
 * The ONLY file that should import @supabase/supabase-js directly outside
 * of the repository layer. Adapters (src/adapters/*) and services
 * (src/services/*) never import this - services depend on repository
 * *interfaces* (src/repository/types.ts), not on Supabase.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in environment. " +
        "This is a service-role connection (refresh worker, admin CLI) - never expose this key client-side.",
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false },
  });
  return cached;
}
