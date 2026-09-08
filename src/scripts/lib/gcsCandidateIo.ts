/**
 * Minimal GCS helpers for the candidate SEARCH runner's Cloud Run entrypoint
 * (evaluate-candidates.ts). No SDK dependency - talks to the GCS JSON API
 * directly via Node's built-in fetch(), authenticating with a short-lived
 * access token fetched from the Cloud Run instance metadata server (the
 * attached service account's ADC token) - never a credential JSON/key file.
 *
 * v0 intentionally does NOT cache the token: one fresh token is fetched
 * immediately before the download call and another immediately before the
 * upload call, so a long-running candidate search batch (many minutes)
 * can never hit mid-run token expiry. This costs one extra metadata
 * round-trip per call (cheap, local-network-only, no external API quota)
 * in exchange for zero cache/refresh logic to get wrong.
 *
 * Security discipline: nothing in this file ever logs or returns an access
 * token, Authorization header value, raw metadata/GCS response body, or
 * signed URL. Every error thrown carries only: which operation
 * (token/download/upload), a bare numeric HTTP status when available, and
 * the non-sensitive gs://bucket/object location - never anything else.
 *
 * Purely in-memory: download returns parsed JSON directly from the response
 * body text, upload sends JS data serialized directly in the request body -
 * no local/temp file is ever written by either function.
 */

export interface GsLocation {
  bucket: string;
  object: string;
}

const GS_URI_PATTERN = /^gs:\/\/([^/]+)\/(.+)$/;

export function isGsUri(uri: string): boolean {
  return GS_URI_PATTERN.test(uri);
}

export function parseGsUri(uri: string): GsLocation {
  const match = GS_URI_PATTERN.exec(uri);
  if (!match) {
    throw new Error(`Not a valid gs://<bucket>/<object> URI: "${uri}"`);
  }
  const [, bucket, object] = match;
  return { bucket, object };
}

export type GcsOperation = "token" | "download" | "upload";

/**
 * Deliberately carries only: which operation failed, a bare numeric HTTP
 * status (when the failure was an HTTP response, not a transport error),
 * and the non-sensitive gs://bucket/object location. Never the metadata
 * server's or GCS's raw response body, never the access token, never any
 * request header.
 */
export class GcsIoError extends Error {
  constructor(
    message: string,
    public readonly operation: GcsOperation,
    public readonly location?: GsLocation,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "GcsIoError";
  }
}

const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

/** Injectable so tests never call the real metadata server/GCS - defaults to Node's built-in global fetch. */
export type FetchFn = typeof fetch;

/**
 * Fetches one short-lived access token for the Cloud Run instance's attached
 * service account. Never caches, never logs the token - the caller uses the
 * returned string in-memory for exactly one Authorization header and then
 * discards it.
 */
export async function getAccessToken(fetchFn: FetchFn = fetch): Promise<string> {
  let res: Response;
  try {
    res = await fetchFn(METADATA_TOKEN_URL, { headers: { "Metadata-Flavor": "Google" } });
  } catch {
    throw new GcsIoError("Failed to reach the metadata server for an access token", "token");
  }
  if (!res.ok) {
    throw new GcsIoError("Metadata server token request failed", "token", undefined, res.status);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new GcsIoError("Metadata server token response was not valid JSON", "token");
  }
  const token = (body as { access_token?: unknown } | null)?.access_token;
  if (typeof token !== "string" || token.length === 0) {
    throw new GcsIoError("Metadata server token response did not contain access_token", "token");
  }
  return token;
}

export async function downloadJsonFromGcs(uri: string, fetchFn: FetchFn = fetch): Promise<unknown> {
  const location = parseGsUri(uri);
  const token = await getAccessToken(fetchFn);

  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(location.bucket)}/o/${encodeURIComponent(location.object)}?alt=media`;
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new GcsIoError(`Failed to download gs://${location.bucket}/${location.object} from GCS`, "download", location);
  }
  if (!res.ok) {
    throw new GcsIoError(`Failed to download gs://${location.bucket}/${location.object} from GCS`, "download", location, res.status);
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new GcsIoError(`Failed to read the response body for gs://${location.bucket}/${location.object}`, "download", location, res.status);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new GcsIoError(`gs://${location.bucket}/${location.object} did not contain valid JSON`, "download", location);
  }
}

export async function uploadJsonToGcs(uri: string, data: unknown, fetchFn: FetchFn = fetch): Promise<void> {
  const location = parseGsUri(uri);
  const token = await getAccessToken(fetchFn);

  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(location.bucket)}/o?uploadType=media&name=${encodeURIComponent(location.object)}`;
  const body = JSON.stringify(data);
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body,
    });
  } catch {
    throw new GcsIoError(`Failed to upload to gs://${location.bucket}/${location.object}`, "upload", location);
  }
  if (!res.ok) {
    throw new GcsIoError(`Failed to upload to gs://${location.bucket}/${location.object}`, "upload", location, res.status);
  }
}
