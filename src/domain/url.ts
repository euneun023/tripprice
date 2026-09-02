/**
 * Whitelists http(s) only for anything that becomes a stored/rendered seller
 * URL (sourceUrl). Blocks javascript:/data:/vbscript:/etc, which the browser
 * would otherwise happily execute or render if such a value ever reached an
 * <a href> or a JSON-LD offer url. Rejects on any parse failure too - an
 * unparsable string is never a legitimate http(s) URL.
 */
export function isHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
