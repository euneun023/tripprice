/**
 * Minimal GCS helpers for the candidate SEARCH runner's Cloud Run entrypoint
 * (evaluate-candidates.ts). Uses the official @google-cloud/storage SDK with
 * Application Default Credentials only - the Storage client below is never
 * constructed with a key/credential file, so in Cloud Run it authenticates
 * as whatever service account is attached to the Job, automatically.
 *
 * Security discipline (matches evaluate-candidates.ts's SafeSourceError):
 * nothing in this file ever reads or logs an access token, Authorization
 * header, signed URL, or object body content in an error. Every error this
 * module throws carries only a fixed, hand-written message referencing the
 * gs://bucket/object location (non-sensitive, operationally necessary) and,
 * where available, a bare numeric HTTP status - never the underlying SDK
 * error's own message/body, which is never inspected or forwarded.
 *
 * Purely in-memory: download returns parsed JSON directly from a Buffer,
 * upload takes JS data and serializes it directly to the GCS object - no
 * local/temp file is ever written by either function.
 */
import { Storage } from "@google-cloud/storage";

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

export class GcsIoError extends Error {
  constructor(
    message: string,
    public readonly location: GsLocation,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "GcsIoError";
  }
}

/** Only ever extracts a bare numeric status code from an unknown thrown value - never any other field. */
function extractHttpStatus(err: unknown): number | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === "number") return code;
  }
  return undefined;
}

/**
 * The narrow slice of the real @google-cloud/storage Storage/Bucket/File API
 * this module actually calls - real Storage instances satisfy this
 * structurally, and tests can pass a plain fake object instead (same
 * injectable-dependency convention as sleepFn/convertFn elsewhere in this
 * repo), so no real GCS call is ever needed to test this file.
 */
export interface GcsFileHandle {
  download(): Promise<[Buffer]>;
  save(data: string, options?: { contentType?: string }): Promise<void>;
}
export interface GcsBucketHandle {
  file(name: string): GcsFileHandle;
}
export interface GcsClient {
  bucket(name: string): GcsBucketHandle;
}

let cachedStorage: Storage | null = null;
/** Application Default Credentials only - relies on the attached Cloud Run
 * service account (or `gcloud auth application-default login` locally);
 * never pass a keyFilename/credentials option here. */
function getStorage(): GcsClient {
  if (!cachedStorage) cachedStorage = new Storage();
  return cachedStorage;
}

export async function downloadJsonFromGcs(uri: string, client: GcsClient = getStorage()): Promise<unknown> {
  const location = parseGsUri(uri);
  let raw: Buffer;
  try {
    [raw] = await client.bucket(location.bucket).file(location.object).download();
  } catch (err) {
    throw new GcsIoError(`Failed to download gs://${location.bucket}/${location.object} from GCS`, location, extractHttpStatus(err));
  }
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new GcsIoError(`gs://${location.bucket}/${location.object} did not contain valid JSON`, location);
  }
}

export async function uploadJsonToGcs(uri: string, data: unknown, client: GcsClient = getStorage()): Promise<void> {
  const location = parseGsUri(uri);
  const body = JSON.stringify(data, null, 2);
  try {
    await client.bucket(location.bucket).file(location.object).save(body, { contentType: "application/json" });
  } catch (err) {
    throw new GcsIoError(`Failed to upload to gs://${location.bucket}/${location.object}`, location, extractHttpStatus(err));
  }
}
