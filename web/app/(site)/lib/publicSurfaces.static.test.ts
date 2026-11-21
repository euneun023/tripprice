/**
 * Static guard: every public surface must reach listings/images only through
 * the public-display policy (src/domain/publicDisplay.ts). Run from web/:
 *   npx tsx "app/(site)/lib/publicSurfaces.static.test.ts"
 * Exits non-zero on any failure.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { SOURCE_IMAGE_HOSTS } from "@core/domain/publicDisplay";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}

const appDir = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(appDir, rel), "utf-8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

// 1. Only the product page may read raw listings; no other public file does.
const publicFiles = walk(join(appDir, "(site)"));
const rawListingReaders = publicFiles.filter((f) => /sourceListings\.(listByVariant|list\w*)\(/.test(readFileSync(f, "utf-8")));
check("only products/[id]/page.tsx reads raw sourceListings in (site)", rawListingReaders.map((f) => f.split("(site)/")[1]).join(","), "products/[id]/page.tsx");

// 2. Product page: raw listings flow through preparePublicListings, raw variant through withPublicImage.
const page = read("(site)/products/[id]/page.tsx");
check("product page filters listings via preparePublicListings", page.includes("preparePublicListings(rawListings"), true);
check("product page filters variant image via withPublicImage", page.includes("withPublicImage(rawVariant"), true);
check("product page never returns the raw variant", /return \{ product, variant \}/.test(page), false);
check("product page builds JSON-LD from filtered quotes", page.includes("buildJsonLdOffers(\n    marketQuotes,"), true);
check("product page OG/metadata image uses the filtered variant", page.includes("image: variant.imageUrl"), true);

// 3. List pages get entries only from catalogService (which applies the policy).
for (const rel of ["(site)/page.tsx", "(site)/categories/[slug]/page.tsx", "(site)/search/page.tsx"]) {
  const src = read(rel);
  check(`${rel} reads data via catalogService`, src.includes("@core/services/catalogService"), true);
  check(`${rel} does not touch canonicalProducts/variant images directly`, /canonicalProducts\.|getVariant\(/.test(src), false);
}

// 4. Sitemap: URLs only - no price, listing or image data.
const sitemap = read("sitemap.ts");
check("sitemap reads no listings", /sourceListings|lastKnownPrice/.test(sitemap), false);
check("sitemap emits no image data", /imageUrl|images:/.test(sitemap), false);

// 5. Every image host next/image may load must be covered by the image policy,
//    otherwise it could be rendered without a source allowlist entry.
const cfg = readFileSync(join(appDir, "..", "next.config.mjs"), "utf-8");
const hosts = [...cfg.matchAll(/hostname: "([^"]+)"/g)].map((m) => m[1]);
const policyHosts = Object.values(SOURCE_IMAGE_HOSTS).flat();
for (const h of hosts) {
  check(`next.config image host ${h} is covered by SOURCE_IMAGE_HOSTS`, policyHosts.some((s) => h === s || h.endsWith(`.${s}`)), true);
}
check("next.config has image hosts to check", hosts.length > 0, true);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
