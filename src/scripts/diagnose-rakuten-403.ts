/**
 * Diagnoses the HTTP 403 all 10 supply-sample items got from Rakuten
 * Ichiba Item Search (see supply-rakuten-sample10.ts - that run reported
 * 10/10 call_failed, but RakutenApiError.body comes from `res.json().catch
 * (() => null)`, which silently becomes null for a non-JSON 403 body (a
 * WAF/gateway-level 403 is very often plain HTML, not Rakuten's own JSON
 * error envelope) - exactly the case we can't currently tell apart from a
 * real Rakuten-side error. This script does ONE raw fetch itself (not
 * through searchRakutenItem) so a non-JSON body is still visible as text,
 * not swallowed into null.
 *
 * Auth/request shape confirmed from src/adapters/rakuten.ts (read, not
 * modified - that file's diff is empty): applicationId + accessKey as
 * query-string parameters on a GET to openapi.rakuten.co.jp; NO Referer
 * header, no other custom header, no body. Duplicated here (not imported)
 * only so this script can read the raw response text itself instead of
 * reusing searchRakutenItem()'s JSON-or-null parsing - the endpoint/params
 * themselves are identical, copied verbatim from that file.
 *
 * This script does NOT conclude which of key/권한/IP 제한/Referer 제한/
 * 엔드포인트 is the cause - it only extracts what Rakuten's response
 * actually says (structured error fields if JSON, raw text otherwise) so
 * a human can match it against Rakuten's own error-code docs. No fix
 * (key reissue, IP allowlist change, etc.) is suggested.
 *
 * Two modes:
 *   npx tsx src/scripts/diagnose-rakuten-403.ts offline   (default)
 *     No network call, no applicationId/accessKey read. Prints the exact
 *     request this would make (query params, redacted) and confirms no
 *     Referer/auth header is sent today.
 *
 *   npx tsx src/scripts/diagnose-rakuten-403.ts live
 *     Requires `live` + applicationId/accessKey in the environment.
 *     Makes EXACTLY 1 HTTP request, no retry, hits=1. Never
 *     reads/prints/stores applicationId or accessKey - only a redacted
 *     URL and the redacted response body/headers.
 */
import "dotenv/config";

// Copied verbatim from src/adapters/rakuten.ts (ENDPOINT + query param
// names) - see this file's header for why it isn't imported.
export const ENDPOINT = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701";
export const DIAGNOSTIC_KEYWORD = "Sony FE 24mm F1.4 GM"; // same keyword already proven to work on 11st - isolates auth/permission from "bad keyword" as a variable

export function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("<redacted>");
}

export function buildUrl(applicationId: string, accessKey: string): URL {
  const url = new URL(ENDPOINT);
  url.searchParams.set("applicationId", applicationId);
  url.searchParams.set("accessKey", accessKey);
  url.searchParams.set("formatVersion", "2");
  url.searchParams.set("keyword", DIAGNOSTIC_KEYWORD);
  url.searchParams.set("hits", "1");
  return url;
}

export function redactUrl(url: URL, applicationId: string, accessKey: string): string {
  const copy = new URL(url.toString());
  copy.searchParams.set("applicationId", "<redacted>");
  copy.searchParams.set("accessKey", "<redacted>");
  return redactSecret(redactSecret(copy.toString(), applicationId), accessKey);
}

/** Headers worth showing for diagnosis (rate-limit/retry hints, content
 * type) - an explicit allowlist, never a blanket dump, so nothing like
 * Set-Cookie accidentally gets printed. */
const SAFE_HEADER_ALLOWLIST = ["content-type", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "date", "server"];

/** Candidate field names for Rakuten's own JSON error envelope, kept
 * narrow and presented as-is (not reinterpreted) - see file header. */
const ERROR_FIELD_CANDIDATES = ["error", "error_description", "message", "Error", "ErrorMessage", "code", "Code"];

function printOfflinePlan() {
  console.log("=== Rakuten 403 diagnosis - OFFLINE (no network call) ===\n");
  console.log("Auth/request shape (from src/adapters/rakuten.ts, unmodified):");
  console.log(`  endpoint: ${ENDPOINT}`);
  console.log("  method: GET, no body");
  console.log("  auth: applicationId + accessKey as QUERY-STRING parameters (not a header, not OAuth)");
  console.log("  headers sent today: NONE beyond fetch's own defaults - no Referer, no Authorization, no custom header");
  console.log(`  diagnostic keyword: "${DIAGNOSTIC_KEYWORD}" (already confirmed live on 11st - rules out 'bad keyword' as a cause)\n`);

  const hasAppId = Boolean(process.env.applicationId);
  const hasAccessKey = Boolean(process.env.accessKey);
  console.log(`applicationId present in env: ${hasAppId} (value never read into this log)`);
  console.log(`accessKey present in env: ${hasAccessKey} (value never read into this log)\n`);

  console.log("Request this would send (query values redacted):");
  console.log(`  ${ENDPOINT}?applicationId=<redacted>&accessKey=<redacted>&formatVersion=2&keyword=${encodeURIComponent(DIAGNOSTIC_KEYWORD)}&hits=1\n`);

  console.log(
    "This script makes NO request yet. To run the single live request (after your approval, with your own env):\n" +
      "  npx tsx src/scripts/diagnose-rakuten-403.ts live",
  );
}

export async function runLive() {
  const applicationId = process.env.applicationId;
  const accessKey = process.env.accessKey;
  if (!applicationId || !accessKey) {
    console.error("Missing applicationId/accessKey (see .env.example) - not making any call.");
    process.exit(1);
  }

  const url = buildUrl(applicationId, accessKey);
  console.log("=== Rakuten 403 diagnosis - LIVE: exactly 1 request, no retry ===\n");
  console.log(`request url (redacted): ${redactUrl(url, applicationId, accessKey)}`);

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`\nTRANSPORT FAILURE (no HTTP response at all): ${redactSecret(redactSecret(message, applicationId), accessKey)}`);
    console.log("-> not a 403; this is a network/DNS/TLS-level failure, check connectivity before anything else.");
    return;
  }

  console.log(`HTTP status: ${res.status}`);

  console.log("\nResponse headers (allowlisted only):");
  for (const name of SAFE_HEADER_ALLOWLIST) {
    const value = res.headers.get(name);
    if (value !== null) console.log(`  ${name}: ${value}`);
  }

  const rawText = await res.text();
  const redactedText = redactSecret(redactSecret(rawText, applicationId), accessKey);

  // Parsed from the already-REDACTED text, never rawText - Rakuten (or a
  // WAF in front of it) could echo applicationId/accessKey back inside an
  // error message field (error_description, etc.), same leak class fixed
  // earlier for the 11st adapter. Redacting only the printed summary
  // fields and not the full JSON.parse source left exactly that gap - see
  // this script's test for the regression this guards.
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(redactedText);
  } catch {
    parsed = null;
  }

  if (parsed) {
    console.log("\nResponse body parsed as JSON. Rakuten error fields found:");
    let anyFound = false;
    for (const key of ERROR_FIELD_CANDIDATES) {
      if (key in parsed) {
        anyFound = true;
        console.log(`  ${key}: ${JSON.stringify((parsed as Record<string, unknown>)[key])}`);
      }
    }
    if (!anyFound) console.log("  (none of the expected error field names were present - see full body below)");
    console.log("\nFull body (redacted, pretty-printed):");
    console.log(JSON.stringify(parsed, null, 2));
  } else {
    console.log(
      "\nResponse body is NOT JSON (likely a WAF/gateway-level page, not Rakuten's own error envelope - " +
        "this itself is diagnostic signal: Rakuten's own API errors are JSON, so a non-JSON 403 body points " +
        "away from a plain 'bad key' rejection and toward something intercepting the request earlier " +
        "- e.g. IP allowlisting or a Referer check - but confirm against the text below, don't assume):",
    );
    console.log(redactedText.slice(0, 3000));
  }

  console.log(
    "\n>> This script draws no conclusion. Compare the fields/text above against Rakuten Developers' own " +
      "error-code reference for ProductSearch/IchibaItem to tell key-invalid vs no-permission vs IP-restricted " +
      "vs Referer-restricted vs endpoint-deprecated apart - do not act on a guess.",
  );
}

async function main() {
  const mode = process.argv[2] ?? "offline";
  if (mode === "live") await runLive();
  else if (mode === "offline") printOfflinePlan();
  else {
    console.error(`Unknown mode "${mode}" - use "offline" (default) or "live".`);
    process.exit(1);
  }
}

const invokedPath = process.argv[1]?.replace(/\\/g, "/");
if (invokedPath && invokedPath.endsWith("diagnose-rakuten-403.ts")) {
  main().catch((err) => {
    console.error("diagnose-rakuten-403 FAILED:", err);
    process.exit(1);
  });
}
