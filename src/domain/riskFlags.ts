/**
 * Manually-curated risk flags for cross-border same-product comparison.
 * Keyed by product_variant_id (NOT canonical_product_id) - sibling variants
 * of the same product (different color / mount / region SKU) can carry
 * different region-lock, voltage, or language risk, so the product level is
 * too coarse to express this correctly.
 *
 * No new DB column: this stays in code (same spirit as the rest of Phase 1's
 * human-in-the-loop approval model) because zero currently-registered
 * variants need a flag - the two candidates that did (Sony FE 24-50mm G /
 * SEL2450G, Garmin Instinct 3 AMOLED 45mm Black) were held out of the DB
 * entirely rather than registered with a flag. Populate this map as future
 * verification rounds find one; a DB-backed version (e.g. a namespaced key
 * inside product_variants.variant_attributes) is a documented option if this
 * ever needs to be admin-editable without a redeploy - not needed yet.
 */

export type RiskFlagType =
  | "region_lock"
  | "voltage_issue"
  | "variant_mismatch"
  | "discontinued"
  | "language_limitation"
  | "warranty_warning";

export interface RiskFlag {
  type: RiskFlagType;
  note?: string;
}

export const RISK_FLAG_LABELS: Record<RiskFlagType, string> = {
  region_lock: "지역락",
  voltage_issue: "전압 문제",
  variant_mismatch: "사양 불일치",
  discontinued: "단종",
  language_limitation: "언어 제한",
  warranty_warning: "보증 주의",
};

/**
 * Flags that make the cross-border comparison meaningless even when the
 * price gap looks great - these block a grade from being "actionable".
 * warranty_warning is deliberately excluded: it's a caution shown alongside
 * the grade, never a same-product blocker (see docs discussion: "warranty
 * warning은 치명적 blocker가 아니라 별도 경고 표시").
 */
const BLOCKING_RISK_TYPES: ReadonlySet<RiskFlagType> = new Set([
  "region_lock",
  "voltage_issue",
  "variant_mismatch",
  "discontinued",
  "language_limitation",
]);

export function isBlockingRisk(type: RiskFlagType): boolean {
  return BLOCKING_RISK_TYPES.has(type);
}

/** product_variant_id -> risk flags. Empty for every currently-registered
 * variant. */
export const RISK_FLAGS_BY_VARIANT: Record<string, RiskFlag[]> = {};

export function getRiskFlags(variantId: string): RiskFlag[] {
  return RISK_FLAGS_BY_VARIANT[variantId] ?? [];
}
