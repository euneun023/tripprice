/**
 * One-off backfill: populate product_variants.image_url for existing
 * variants using the SAME adapters/identifiers already stored on their
 * approved listings (searchKeywordUsed + externalId) - the same
 * re-identify pattern refreshService uses, just reading the image field
 * this time instead of the price. No new product data, no mock images.
 *
 * Priority when a variant has listings on both sources: prefer a
 * 'verified' confidence listing over 'estimated', and prefer rakuten over
 * coupang when both are equally confident - deterministic, documented,
 * never affects price/winner logic (this script only writes image_url).
 *
 * --upgrade: swap an already-set image_url for a higher-res URL of the
 * SAME photo (same listing, same file, just a bigger rendition) - separate
 * from the normal missing-only backfill above, only run on explicit request.
 */
import "dotenv/config";
import { createSupabaseRepositories } from "../repository/supabase/index";
import { searchRakutenItem } from "../adapters/rakuten";
import { searchCoupangProduct } from "../adapters/coupang";

const rakutenCreds = { applicationId: process.env.applicationId!, accessKey: process.env.accessKey! };
const coupangCreds = {
  accessKey: process.env.COUPANG_PARTNERS_ACCESS_KEY!,
  secretKey: process.env.COUPANG_PARTNERS_SECRET_KEY!,
};

// Rakuten's Item Search API only ever returns small (64px) / medium (128px)
// URLs - there's no separate "large" field. thumbnail.image.rakuten.co.jp
// (the same host those URLs already point at) resizes via this _ex=WxH
// query param - it's the exact mechanism the API itself uses to tell
// small/medium apart on the identical base path. Confirmed live: requesting
// larger than the source photo's native size does not error or fetch
// anything from elsewhere, it just caps at the original upload's size.
const RAKUTEN_UPSIZE = "800x800";

function upsizeRakutenUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.set("_ex", RAKUTEN_UPSIZE);
  return u.toString();
}

async function findRakutenImage(keyword: string, externalId: string): Promise<string | null> {
  const result = await searchRakutenItem({ ...rakutenCreds, keyword, hits: 15 });
  const item = result.items.find((i) => i.itemCode === externalId);
  const url = item?.mediumImageUrls?.[0] ?? item?.smallImageUrls?.[0] ?? null;
  return url ? upsizeRakutenUrl(url) : null;
}

async function findCoupangImage(keyword: string, externalId: string): Promise<string | null> {
  const result = await searchCoupangProduct(coupangCreds, keyword, 10);
  const item = result.items.find((i) => String(i.productId) === externalId);
  return item?.productImage ?? null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const upgrade = process.argv.includes("--upgrade");
  const repos = createSupabaseRepositories();
  const pairs = await repos.canonicalProducts.listAllVariants();

  let updated = 0;
  let skippedHasImage = 0;
  let skippedNoImageFound = 0;
  let skippedNoChange = 0;

  for (const { product, variant } of pairs) {
    if (variant.imageUrl && !upgrade) {
      skippedHasImage++;
      continue;
    }

    const listings = (await repos.sourceListings.listByVariant(variant.id)).filter((l) => l.isActive);
    if (listings.length === 0) continue;

    // deterministic priority: verified before estimated, rakuten before coupang
    const ordered = [...listings].sort((a, b) => {
      if (a.confidence !== b.confidence) return a.confidence === "verified" ? -1 : 1;
      if (a.sourceId !== b.sourceId) return a.sourceId === "rakuten" ? -1 : 1;
      return 0;
    });

    let imageUrl: string | null = null;
    let usedListing: (typeof ordered)[number] | null = null;

    for (const listing of ordered) {
      try {
        if (listing.sourceId === "rakuten") {
          imageUrl = await findRakutenImage(listing.searchKeywordUsed, listing.externalId);
        } else if (listing.sourceId === "coupang") {
          imageUrl = await findCoupangImage(listing.searchKeywordUsed, listing.externalId);
        }
      } catch (err) {
        console.log(`  [warn] ${listing.sourceId} lookup failed for ${product.brand} ${product.officialName}: ${err}`);
      }
      if (imageUrl) {
        usedListing = listing;
        break;
      }
    }

    if (imageUrl && usedListing) {
      if (upgrade && variant.imageUrl === imageUrl) {
        skippedNoChange++;
        continue;
      }
      const verb = upgrade ? "upgrade" : "set";
      const detail = upgrade
        ? `${product.brand} ${product.officialName} <- ${usedListing.sourceId} (${usedListing.confidence}): ${variant.imageUrl ?? "(none)"} -> ${imageUrl}`
        : `${product.brand} ${product.officialName} <- ${usedListing.sourceId} (${usedListing.confidence}): ${imageUrl}`;
      if (!dryRun) {
        if (upgrade) {
          await repos.canonicalProducts.updateVariantImage(variant.id, imageUrl);
        } else {
          await repos.canonicalProducts.setVariantImageIfMissing(variant.id, imageUrl);
        }
      }
      console.log(`[${dryRun ? `dry-run would ${verb}` : `image ${verb}d`}] ${detail}`);
      updated++;
    } else {
      console.log(`[no image found] ${product.brand} ${product.officialName}`);
      skippedNoImageFound++;
    }
  }

  console.log(
    `\nDone${dryRun ? " (dry run, no writes)" : ""}${upgrade ? " (upgrade mode)" : ""}. updated=${updated} alreadyHadImage=${skippedHasImage} noImageFound=${skippedNoImageFound} noChange=${skippedNoChange}`,
  );
}

main().catch((err) => {
  console.error("Backfill FAILED:", err);
  process.exit(1);
});
