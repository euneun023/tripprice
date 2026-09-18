/**
 * Tests for remapListing() - safe listing-to-listing remap that preserves
 * both rows' price history and never mutates the old row's
 * externalId/sourceUrl. No test runner is configured in this repo (see
 * refreshService.test.ts for the same plain-assertion convention) - run
 * directly: npx tsx src/services/mappingService.test.ts
 * Exits non-zero on any failure.
 */
import { remapListing, RemapDuplicateActiveError, type RemapListingInput } from "./mappingService";
import type { PriceHistoryEntry, ReviewActionInput, SourceListing } from "../domain/types";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} ${name} - got ${JSON.stringify(actual)}${pass ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!pass) failures++;
}
async function checkThrows(name: string, fn: () => Promise<unknown>, messageIncludes?: string) {
  try {
    await fn();
    console.log(`FAIL ${name} - expected throw, got none`);
    failures++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const pass = messageIncludes ? msg.includes(messageIncludes) : true;
    console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : ` - message "${msg}" did not include "${messageIncludes}"`}`);
    if (!pass) failures++;
  }
}

function makeListing(overrides: Partial<SourceListing> = {}): SourceListing {
  return {
    id: "old-listing-1",
    productVariantId: "variant-tamron-jp",
    sourceId: "rakuten",
    externalId: "emedama:11241852",
    externalIdType: "rakuten_item_code",
    sourceUrl: "https://item.rakuten.co.jp/emedama/11241852/",
    searchKeywordUsed: "Tamron 35-100mm",
    approvedAt: "2026-06-01T00:00:00.000Z",
    approvedBy: "tester",
    confidence: "verified",
    lastCheckedAt: "2026-09-10T00:00:00.000Z",
    lastSuccessAt: "2026-09-10T00:00:00.000Z",
    staleAfterHours: 24,
    reviewRequired: false,
    reviewReason: null,
    lastKnownPrice: 134640,
    lastKnownCurrency: "JPY",
    lastKnownAvailability: true,
    shippingStatus: "unknown",
    isActive: true,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...overrides,
  };
}

function baseInput(overrides: Partial<RemapListingInput> = {}): RemapListingInput {
  return {
    oldSourceListingId: "old-listing-1",
    expectedProductVariantId: "variant-tamron-jp",
    expectedSourceId: "rakuten",
    newExternalId: "winkstore:10041507",
    externalIdType: "rakuten_item_code",
    sourceUrl: "https://item.rakuten.co.jp/winkstore/10041507/",
    searchKeywordUsed: "Tamron 35-100mm",
    approvedBy: "tester",
    confidence: "verified",
    initialPrice: 118576,
    initialCurrency: "JPY",
    initialAvailability: true,
    reviewReason: "cheaper verified in-stock alternative on same source",
    detectedAt: "2026-09-18T00:00:00.000Z",
    note: "phase2-g1b",
    ...overrides,
  };
}

/** In-memory fake repos, seeded with an optional existing "new" listing to model partial-remap states. */
function makeRepos(opts: { old?: Partial<SourceListing>; existingNew?: Partial<SourceListing> } = {}) {
  const old = makeListing(opts.old);
  const listings = new Map<string, SourceListing>([[old.id, old]]);
  if (opts.existingNew) {
    const n = makeListing({ id: "new-listing-1", externalId: "winkstore:10041507", isActive: true, ...opts.existingNew });
    listings.set(n.id, n);
  }

  const calls = {
    create: [] as unknown[],
    update: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    appendPriceHistory: [] as PriceHistoryEntry[],
    reviewActions: [] as ReviewActionInput[],
  };

  let failCreate = false;
  let failUpdateOnce = false;
  let failReviewAction = false;
  let nextId = 100;

  const repos = {
    sourceListings: {
      getById: async (id: string) => listings.get(id) ?? null,
      findByExternalId: async (sourceId: string, externalId: string) => {
        for (const l of listings.values()) {
          if (l.sourceId === sourceId && l.externalId === externalId) return l;
        }
        return null;
      },
      create: async (input: Record<string, unknown>) => {
        calls.create.push(input);
        if (failCreate) throw new Error("simulated create failure (e.g. seller API rejected)");
        const listing = makeListing({
          id: `new-listing-${nextId++}`,
          productVariantId: input.productVariantId as string,
          sourceId: input.sourceId as string,
          externalId: input.externalId as string,
          externalIdType: input.externalIdType as string,
          sourceUrl: input.sourceUrl as string | null,
          searchKeywordUsed: input.searchKeywordUsed as string,
          approvedBy: input.approvedBy as string,
          confidence: input.confidence as SourceListing["confidence"],
          lastKnownPrice: input.initialPrice as number | null,
          lastKnownCurrency: input.initialCurrency as string | null,
          lastKnownAvailability: input.initialAvailability as boolean | null,
          isActive: true,
        });
        listings.set(listing.id, listing);
        return listing;
      },
      update: async (id: string, patch: Record<string, unknown>) => {
        calls.update.push({ id, patch });
        if (failUpdateOnce) {
          failUpdateOnce = false;
          throw new Error("simulated update failure (e.g. network blip)");
        }
        const existing = listings.get(id);
        if (!existing) throw new Error(`update: no such listing ${id}`);
        const updated = { ...existing, ...patch } as SourceListing;
        listings.set(id, updated);
        return updated;
      },
    },
    priceHistory: {
      append: async (entry: PriceHistoryEntry) => {
        calls.appendPriceHistory.push(entry);
      },
    },
    reviewActions: {
      record: async (input: ReviewActionInput) => {
        calls.reviewActions.push(input);
        if (failReviewAction) throw new Error("simulated review_actions insert failure");
      },
    },
  };

  return {
    repos,
    calls,
    listings,
    setFailCreate: (v: boolean) => (failCreate = v),
    setFailUpdateOnce: (v: boolean) => (failUpdateOnce = v),
    setFailReviewAction: (v: boolean) => (failReviewAction = v),
  };
}

async function main() {
  // ============================================================
  // 1. Normal remap
  // ============================================================
  {
    const { repos, calls, listings } = makeRepos();
    const result = await remapListing(repos as never, baseInput());

    check("normal remap: status", result.status, "remapped");
    check("normal remap: old listing deactivated", result.oldListing.isActive, false);
    check("normal remap: old externalId unchanged", result.oldListing.externalId, "emedama:11241852");
    check("normal remap: old sourceUrl unchanged", result.oldListing.sourceUrl, "https://item.rakuten.co.jp/emedama/11241852/");
    check("normal remap: new listing active", result.newListing.isActive, true);
    check("normal remap: new listing externalId", result.newListing.externalId, "winkstore:10041507");
    check("normal remap: new listing same variant", result.newListing.productVariantId, "variant-tamron-jp");
    check("normal remap: new listing same source", result.newListing.sourceId, "rakuten");
    check("normal remap: audit recorded", result.auditRecorded, true);
    check("normal remap: exactly one create() call", calls.create.length, 1);
    check("normal remap: exactly one update() call (deactivate)", calls.update.length, 1);
    check("normal remap: update() only touched isActive", calls.update[0].patch, { isActive: false });
    check(
      "normal remap: both listings present, exactly one active",
      [...listings.values()].filter((l) => l.isActive).length,
      1,
    );
    check("normal remap: price_history appended for new listing", calls.appendPriceHistory.length, 1);
    check("normal remap: review_action sourceListingId = old id", calls.reviewActions[0]?.sourceListingId, "old-listing-1");
    check("normal remap: review_action resolution", calls.reviewActions[0]?.resolution, "remapped");
  }

  // ============================================================
  // 2. new approve failure -> old listing stays active
  // ============================================================
  {
    const helper = makeRepos();
    helper.setFailCreate(true);

    await checkThrows(
      "approve failure: throws",
      () => remapListing(helper.repos as never, baseInput()),
      "old listing old-listing-1 left untouched",
    );
    check("approve failure: old listing never updated", helper.calls.update.length, 0);
    check("approve failure: old listing still active", helper.listings.get("old-listing-1")?.isActive, true);
    check("approve failure: no review_action recorded", helper.calls.reviewActions.length, 0);
  }

  // ============================================================
  // 3. old deactivate failure -> both active + explicit failure (RemapDuplicateActiveError)
  // ============================================================
  {
    const helper = makeRepos();
    helper.setFailUpdateOnce(true);

    let caught: unknown;
    try {
      await remapListing(helper.repos as never, baseInput());
    } catch (err) {
      caught = err;
    }
    check("deactivate failure: throws RemapDuplicateActiveError", caught instanceof RemapDuplicateActiveError, true);
    if (caught instanceof RemapDuplicateActiveError) {
      check("deactivate failure: error carries old listing id", caught.oldListingId, "old-listing-1");
      check("deactivate failure: error message mentions BOTH ARE NOW ACTIVE", caught.message.includes("BOTH LISTINGS ARE NOW ACTIVE"), true);
    }
    check("deactivate failure: new listing was created", helper.calls.create.length, 1);
    check("deactivate failure: old listing still active (not rolled back to inactive)", helper.listings.get("old-listing-1")?.isActive, true);
    const newListingId = [...helper.listings.keys()].find((id) => id !== "old-listing-1");
    check("deactivate failure: new listing is also active (duplicate active, by design)", newListingId ? helper.listings.get(newListingId)?.isActive : undefined, true);
    check("deactivate failure: no review_action recorded yet", helper.calls.reviewActions.length, 0);

    // Retry with the same input should resume: reuse the existing new listing, retry only the deactivate step.
    const result = await remapListing(helper.repos as never, baseInput());
    check("deactivate failure retry: succeeds", result.status, "remapped");
    check("deactivate failure retry: does not create a second new listing", helper.calls.create.length, 1);
    check("deactivate failure retry: old listing now inactive", helper.listings.get("old-listing-1")?.isActive, false);
  }

  // ============================================================
  // 4. Same request re-run -> no duplicate row
  // ============================================================
  {
    const helper = makeRepos();
    const first = await remapListing(helper.repos as never, baseInput());
    const second = await remapListing(helper.repos as never, baseInput());

    check("re-run: first call creates the new listing", helper.calls.create.length, 1);
    check("re-run: second call does not create another", helper.calls.create.length, 1);
    check("re-run: second call reuses the same new listing id", second.newListing.id, first.newListing.id);
    check(
      "re-run: exactly one active listing total",
      [...helper.listings.values()].filter((l) => l.isActive).length,
      1,
    );
  }

  // ============================================================
  // 5. Already-remapped replay
  // ============================================================
  {
    const helper = makeRepos({
      old: { isActive: false },
      existingNew: { isActive: true },
    });

    const result = await remapListing(helper.repos as never, baseInput());
    check("already-remapped: status", result.status, "already-remapped");
    check("already-remapped: no create() call", helper.calls.create.length, 0);
    check("already-remapped: no update() call", helper.calls.update.length, 0);
    check("already-remapped: no review_action recorded (no duplicate audit entry)", helper.calls.reviewActions.length, 0);
    check("already-remapped: auditRecorded is false (no-op, not a failure)", result.auditRecorded, false);
    check("already-remapped: old listing reported inactive", result.oldListing.isActive, false);
    check("already-remapped: new listing reported active", result.newListing.isActive, true);
  }

  // ============================================================
  // 6. Different variant/source remap refused
  // ============================================================
  {
    const helper = makeRepos();
    await checkThrows(
      "wrong expectedProductVariantId: refused",
      () => remapListing(helper.repos as never, baseInput({ expectedProductVariantId: "some-other-variant" })),
      "does not match expectedProductVariantId",
    );
    check("wrong variant: nothing created", helper.calls.create.length, 0);
    check("wrong variant: nothing updated", helper.calls.update.length, 0);

    const helper2 = makeRepos();
    await checkThrows(
      "wrong expectedSourceId: refused",
      () => remapListing(helper2.repos as never, baseInput({ expectedSourceId: "coupang" })),
      "does not match expectedSourceId",
    );
    check("wrong source: nothing created", helper2.calls.create.length, 0);
    check("wrong source: nothing updated", helper2.calls.update.length, 0);
  }

  // ============================================================
  // 7. review_actions content
  // ============================================================
  {
    const helper = makeRepos();
    const result = await remapListing(helper.repos as never, baseInput());
    const action = helper.calls.reviewActions[0];
    check("audit: exactly one review_action", helper.calls.reviewActions.length, 1);
    check("audit: sourceListingId is OLD listing id", action?.sourceListingId, "old-listing-1");
    check("audit: resolution", action?.resolution, "remapped");
    check("audit: reason forwarded", action?.reason, "cheaper verified in-stock alternative on same source");
    check("audit: detectedAt forwarded", action?.detectedAt, "2026-09-18T00:00:00.000Z");
    check("audit: resolvedBy forwarded", action?.resolvedBy, "tester");
    check("audit: note mentions old externalId", action?.note?.includes("emedama:11241852"), true);
    check("audit: note mentions new externalId", action?.note?.includes("winkstore:10041507"), true);
    check("audit: note mentions new listing id", action?.note?.includes(result.newListing.id), true);
    check("audit: note includes caller-supplied extra note", action?.note?.includes("phase2-g1b"), true);
  }

  // ============================================================
  // Extra: audit record failure is reported separately, not hidden,
  // and does not undo the already-successful remap.
  // ============================================================
  {
    const helper = makeRepos();
    helper.setFailReviewAction(true);
    const result = await remapListing(helper.repos as never, baseInput());

    check("audit failure: remap itself still succeeds", result.status, "remapped");
    check("audit failure: old listing still deactivated", result.oldListing.isActive, false);
    check("audit failure: new listing still active", result.newListing.isActive, true);
    check("audit failure: auditRecorded is false", result.auditRecorded, false);
    check("audit failure: auditError is populated", typeof result.auditError === "string" && result.auditError.length > 0, true);
  }

  // ============================================================
  // Extra guard: attempting to "remap" to the same externalId is refused
  // ============================================================
  {
    const helper = makeRepos();
    await checkThrows(
      "same externalId: refused",
      () => remapListing(helper.repos as never, baseInput({ newExternalId: "emedama:11241852" })),
      "nothing to remap",
    );
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
