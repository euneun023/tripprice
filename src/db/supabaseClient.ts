/**
 * The ONLY file that should import @supabase/supabase-js directly outside
 * of the repository layer. Adapters (src/adapters/*) and services
 * (src/services/*) never import this - services depend on repository
 * *interfaces* (src/repository/types.ts), not on Supabase.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Fetch = typeof fetch;

/**
 * Wraps `baseFetch` so a response that is HTTP 401 with a PostgREST
 * `PGRST303` ("JWT issued at future") body is retried exactly once, after
 * `delayMs` - a transient condition observed in production (see the
 * PGRST303 incident notes) where the very first request through a fresh
 * container/token pairing is rejected once and every request after it
 * succeeds. Every other status, error, or non-PGRST303 401 body passes
 * through unchanged - this is not a general-purpose retry wrapper.
 * Never inspects or logs Authorization/apikey headers or response bodies;
 * only the parsed `code` field is read, to decide whether to retry.
 * `sleepFn` is injectable so tests never actually wait.
 */
export function createFetchWithPgrst303Retry(
  baseFetch: Fetch,
  delayMs = 2000,
  sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.status !== 401) return response;

    let code: unknown;
    try {
      code = (await response.clone().json())?.code;
    } catch {
      return response;
    }
    if (code !== "PGRST303") return response;

    await sleepFn(delayMs);
    return baseFetch(input, init);
  };
}

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
    global: { fetch: createFetchWithPgrst303Retry(fetch) },
  });
  return cached;
}
